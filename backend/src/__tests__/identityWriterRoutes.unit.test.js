const express = require('express');
const request = require('supertest');

jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('bcryptjs', () => ({
  hash: jest.fn(async () => 'hashed-password'),
  compare: jest.fn(async () => false),
}));
jest.mock('../middleware/authMiddleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000001',
      user_id: '00000000-0000-4000-8000-000000000001',
      user_type: 'platform_admin',
      role: req.get('x-test-role') || 'system_admin',
      email: 'admin@example.com',
      full_name: 'Test Admin',
    };
    next();
  },
  requireRole: (...roles) => (req, res, next) => (
    roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ error: 'Insufficient permissions' })
  ),
}));
jest.mock('../services/emailService', () => ({
  sendInvitation: jest.fn(async () => undefined),
  sendPasswordReset: jest.fn(async () => undefined),
  sendWelcome: jest.fn(async () => undefined),
}));
jest.mock('../services/bidService', () => ({ getOrganizationBids: jest.fn() }));

const pool = require('../config/db');
const { sendInvitation, sendPasswordReset } = require('../services/emailService');
const adminRouter = require('../routes/admin');
const registrationRouter = require('../routes/registration');
const tenantRouter = require('../routes/tenant');

const ADMIN_ID = '00000000-0000-4000-8000-000000000010';
const TENANT_ID = '00000000-0000-4000-8000-000000000011';
const TENANT_USER_ID = '00000000-0000-4000-8000-000000000012';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  app.use('/api', tenantRouter);
  app.use('/api', registrationRouter);
  return app;
}

function makeClient({
  duplicateIdentity = false,
  pendingInvitation = false,
  invitation = null,
  toggleUser = null,
} = {}) {
  return {
    query: jest.fn(async (sql, params = []) => {
      if (sql.includes('SELECT candidate.user_type')) {
        return {
          rows: duplicateIdentity
            ? [{ user_type: 'supplier_user', id: TENANT_USER_ID }]
            : [],
        };
      }
      if (sql.includes('WHERE role = $1 AND is_active = true')) return { rows: [] };
      if (sql.includes('SELECT id FROM invitations')) {
        return { rows: pendingInvitation ? [{ id: 1 }] : [] };
      }
      if (sql.includes('SELECT * FROM invitations')) {
        return { rows: invitation ? [invitation] : [] };
      }
      if (sql.includes('FROM tenant_users') && sql.includes('FOR UPDATE')) {
        return { rows: toggleUser ? [toggleUser] : [] };
      }
      if (sql.includes('INSERT INTO platform_admins')) {
        return {
          rows: [{
            id: ADMIN_ID,
            email: params[0],
            full_name: params[2],
            role: params[3],
          }],
        };
      }
      if (sql.includes('INSERT INTO tenant_users')) {
        return {
          rows: [{
            id: TENANT_USER_ID,
            tenant_id: params[0],
            email: params[1],
            full_name: params[3],
            role: 'customer',
            is_active: true,
          }],
        };
      }
      if (sql.includes('UPDATE tenant_users') && sql.includes('RETURNING')) {
        return {
          rows: [{ ...toggleUser, is_active: params[0] }],
        };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
}

describe('identity writer routes', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
    sendInvitation.mockResolvedValue(undefined);
    sendPasswordReset.mockResolvedValue(undefined);
  });

  test('normalizes, guards, and audits platform administrator creation', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .post('/api/admin/admins')
      .send({
        email: ' NEW.ADMIN@EXAMPLE.COM ',
        full_name: '  New Admin  ',
        password: 'SecurePass1!',
        role: 'business_admin',
      });

    expect(response.statusCode).toBe(201);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT candidate.user_type'),
      ['new.admin@example.com']
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO platform_admins'),
      ['new.admin@example.com', 'hashed-password', 'New Admin', 'business_admin']
    );
    expect(client.query.mock.calls.some(([sql]) => (
      sql.includes("'platform_admin_created'")
    ))).toBe(true);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('returns a persisted-invitation warning instead of a post-commit 500', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);
    sendInvitation.mockRejectedValue(new Error('SMTP unavailable'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post('/api/admin/invitations')
      .set('x-test-role', 'business_admin')
      .send({ email: ' INVITED@EXAMPLE.COM ', role: 'supplier' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      email: 'invited@example.com',
      email_delivered: false,
    }));
    expect(response.body.message).toMatch(/invitation created/i);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  test('normalizes and guards administrator-created customer identities', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .post('/api/admin/tenant-users')
      .send({
        tenant_id: TENANT_ID,
        email: ' CUSTOMER@EXAMPLE.COM ',
        full_name: '  Customer User  ',
        password: 'SecurePass1!',
      });

    expect(response.statusCode).toBe(201);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT candidate.user_type'),
      ['customer@example.com']
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tenant_users'),
      [TENANT_ID, 'customer@example.com', 'hashed-password', 'Customer User', 'customer']
    );
  });

  test('guards and audits legacy customer reactivation', async () => {
    const toggleUser = {
      id: TENANT_USER_ID,
      email: ' LEGACY@EXAMPLE.COM ',
      full_name: 'Legacy Customer',
      role: 'customer',
      is_active: false,
    };
    const client = makeClient({ toggleUser });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .put(`/api/admin/tenant-users/${TENANT_USER_ID}/toggle-active`);

    expect(response.statusCode).toBe(200);
    expect(response.body.is_active).toBe(true);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT candidate.user_type'),
      ['legacy@example.com', 'tenant_user', TENANT_USER_ID]
    );
    expect(client.query.mock.calls.some(([sql]) => (
      sql.includes("'tenant_user'") && sql.includes('INSERT INTO audit_log')
    ))).toBe(true);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('blocks legacy customer reactivation when a normalized identity conflicts', async () => {
    const toggleUser = {
      id: TENANT_USER_ID,
      email: 'duplicate@example.com',
      full_name: 'Legacy Customer',
      role: 'customer',
      is_active: false,
    };
    const client = makeClient({ toggleUser, duplicateIdentity: true });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .put(`/api/admin/tenant-users/${TENANT_USER_ID}/toggle-active`);

    expect(response.statusCode).toBe(409);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE tenant_users'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_log'))).toBe(false);
  });

  test('cleans invitation identity fields and rechecks email ownership at acceptance', async () => {
    const client = makeClient({
      invitation: {
        id: 7,
        email: ' INVITED.SUPPLIER@EXAMPLE.COM ',
        role: 'supplier',
      },
    });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .post('/api/accept-invitation')
      .send({
        token: 'invitation-token',
        password: 'SecurePass1!',
        full_name: '  Supplier Contact  ',
        company_name: '  Professional Supplies Ltd  ',
      });

    expect(response.statusCode).toBe(200);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT candidate.user_type'),
      ['invited.supplier@example.com']
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO suppliers'),
      [expect.any(String), 'Professional Supplies Ltd']
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO supplier_users'),
      [
        expect.any(String),
        expect.any(String),
        'invited.supplier@example.com',
        'hashed-password',
        'Supplier Contact',
      ]
    );
  });

  test('rejects overlong invitation identity fields before opening a transaction', async () => {
    const response = await request(app)
      .post('/api/accept-invitation')
      .send({
        token: 'invitation-token',
        password: 'SecurePass1!',
        full_name: 'x'.repeat(151),
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toMatch(/150 character limit/i);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('does not select or reset one of several ambiguous password-reset identities', async () => {
    pool.query.mockResolvedValue({
      rows: [
        { id: TENANT_USER_ID, ut: 'tenant_user' },
        { id: ADMIN_ID, ut: 'platform_admin' },
      ],
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post('/api/forgot-password')
      .send({ email: ' DUPLICATE@EXAMPLE.COM ' });

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toMatch(/if the email exists/i);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(sendPasswordReset).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('preserves the anti-enumeration response when reset email delivery fails', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: TENANT_USER_ID, ut: 'tenant_user' }] })
      .mockResolvedValueOnce({ rows: [] });
    sendPasswordReset.mockRejectedValue(new Error('SMTP unavailable'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post('/api/forgot-password')
      .send({ email: ' CUSTOMER@EXAMPLE.COM ' });

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toMatch(/if the email exists/i);
    expect(pool.query.mock.calls[1][1]).toEqual([
      TENANT_USER_ID,
      'tenant_user',
      expect.any(String),
      expect.any(Date),
    ]);
    expect(sendPasswordReset).toHaveBeenCalledWith(
      'customer@example.com',
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});
