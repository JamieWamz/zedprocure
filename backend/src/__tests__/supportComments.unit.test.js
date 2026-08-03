const express = require('express');
const request = require('supertest');

jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../middleware/authMiddleware', () => ({
  authenticate: (req, _res, next) => {
    const reporter = req.get('x-test-user') === 'reporter';
    req.user = reporter
      ? {
          user_id: '00000000-0000-4000-8000-000000000002',
          user_type: 'tenant_user',
          role: 'customer',
          email: 'customer@example.com',
          full_name: 'Test Customer',
          tenant_id: '00000000-0000-4000-8000-000000000003',
        }
      : {
          user_id: '00000000-0000-4000-8000-000000000001',
          user_type: 'platform_admin',
          role: 'business_admin',
          email: 'care@example.com',
          full_name: 'Customer Care',
        };
    next();
  },
  requireRole: (...roles) => (req, res, next) => (
    roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' })
  ),
}));
jest.mock('../services/notificationService', () => ({
  createNotification: jest.fn(async () => undefined),
  notifyBusinessAdmins: jest.fn(async () => undefined),
}));

const pool = require('../config/db');
const { createNotification, notifyBusinessAdmins } = require('../services/notificationService');
const supportRouter = require('../routes/support');

const ISSUE_ID = '00000000-0000-4000-8000-000000000010';
const REPORTER_ID = '00000000-0000-4000-8000-000000000002';
const COMMENT_ID = '00000000-0000-4000-8000-000000000011';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/support', supportRouter);
  return app;
}

function makeClient({ reporterId = REPORTER_ID, initialStatus = 'open' } = {}) {
  return {
    query: jest.fn(async (sql, params = []) => {
      if (sql.includes('SELECT * FROM support_issues')) {
        return { rows: [{
          id: ISSUE_ID,
          reference: 'FS-20260803-ABC123',
          reporter_user_id: reporterId,
          reporter_user_type: 'tenant_user',
          status: initialStatus,
        }] };
      }
      if (sql.includes('INSERT INTO support_issue_comments')) {
        return { rows: [{
          id: COMMENT_ID,
          issue_id: ISSUE_ID,
          author_user_id: params[1],
          author_user_type: params[2],
          author_name: params[3],
          author_email: params[4],
          body: params[5],
          created_at: '2026-08-03T12:00:00.000Z',
        }] };
      }
      if (sql.includes('UPDATE support_issues')) {
        if (sql.includes('resolution_note')) {
          return { rows: [{
            id: ISSUE_ID,
            reference: 'FS-20260803-ABC123',
            reporter_user_id: reporterId,
            reporter_user_type: 'tenant_user',
            status: params[0],
            resolution_note: params[1],
          }] };
        }
        const adminUpdate = sql.includes('assigned_admin_id');
        return { rows: [{
          status: adminUpdate
            ? (initialStatus === 'open' ? 'in_progress' : initialStatus)
            : (['resolved', 'closed'].includes(initialStatus) ? 'open' : initialStatus),
        }] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
}

describe('support issue conversations', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('customer care appends a comment and moves an open issue into progress', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .post(`/api/support/issues/${ISSUE_ID}/comments`)
      .send({ body: 'We found the upload problem and are checking it now.' });

    expect(response.statusCode).toBe(201);
    expect(response.body.status).toBe('in_progress');
    expect(response.body.comment.body).toMatch(/upload problem/);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO support_issue_comments'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => sql.includes("'support_issue_comment_added'"))).toBe(true);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: REPORTER_ID,
      type: 'support_issue_comment',
    }));
  });

  test('a customer reply reopens a resolved issue and notifies customer care', async () => {
    const client = makeClient({ initialStatus: 'resolved' });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .post(`/api/support/issues/${ISSUE_ID}/comments`)
      .set('x-test-user', 'reporter')
      .send({ body: 'The same error is still happening.' });

    expect(response.statusCode).toBe(201);
    expect(response.body.status).toBe('open');
    expect(notifyBusinessAdmins).toHaveBeenCalledWith(expect.objectContaining({
      type: 'support_issue_reply',
    }));
  });

  test('a different customer cannot add a comment to another reporter issue', async () => {
    const client = makeClient({ reporterId: '00000000-0000-4000-8000-000000000099' });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .post(`/api/support/issues/${ISSUE_ID}/comments`)
      .set('x-test-user', 'reporter')
      .send({ body: 'I should not be allowed into this conversation.' });

    expect(response.statusCode).toBe(403);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO support_issue_comments'))).toBe(false);
  });

  test('a resolved issue still returns success when reporter notification delivery fails', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);
    createNotification.mockRejectedValueOnce(new Error('notification database unavailable'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .put(`/api/support/issues/${ISSUE_ID}`)
      .send({ status: 'resolved', resolution_note: 'The document upload configuration was corrected.' });

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe('resolved');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(0);
    consoleSpy.mockRestore();
  });
});
