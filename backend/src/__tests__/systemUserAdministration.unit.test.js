const express = require('express');
const request = require('supertest');

jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../middleware/authMiddleware', () => ({
  authenticate: (req, _res, next) => {
    const id = req.get('x-test-user-id') || '00000000-0000-4000-8000-000000000001';
    req.user = {
      id,
      user_id: id,
      user_type: 'platform_admin',
      role: req.get('x-test-role') || 'system_admin',
      email: 'system.admin@example.com',
      full_name: 'System Admin',
    };
    next();
  },
  requireRole: (...roles) => (req, res, next) => (
    roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ error: 'Insufficient permissions' })
  ),
}));
jest.mock('../services/systemOperationsService', () => ({
  executeOperation: jest.fn(),
  getControlPlane: jest.fn(),
  getOperationHistory: jest.fn(),
}));

const pool = require('../config/db');
const systemRouter = require('../routes/system');

const PRIMARY_ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const BUSINESS_ADMIN_ID = '00000000-0000-4000-8000-000000000002';
const TENANT_USER_ID = '00000000-0000-4000-8000-000000000003';
const SUPPLIER_USER_ID = '00000000-0000-4000-8000-000000000004';
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000005';
const COMPANY_ID = '00000000-0000-4000-8000-000000000006';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', systemRouter);
  return app;
}

function makeClient({
  existing = {
    id: TENANT_USER_ID,
    email: 'old@example.com',
    full_name: 'Old Name',
    role: 'customer',
    is_active: true,
  },
  duplicate = false,
  activeSeat = false,
  updated = {
    id: TENANT_USER_ID,
    user_type: 'tenant_user',
    role: 'customer',
    email: 'updated@example.com',
    full_name: 'Updated Name',
    is_active: false,
    organization_id: ORGANIZATION_ID,
    organization_name: 'Acme Zambia',
    company_id: null,
    company_name: null,
  },
} = {}) {
  return {
    query: jest.fn(async sql => {
      if (sql.includes('FOR UPDATE')) return { rows: existing ? [existing] : [] };
      if (sql.includes('WHERE role = $1 AND is_active = true')) {
        return { rows: activeSeat ? [{ id: BUSINESS_ADMIN_ID }] : [] };
      }
      if (sql.includes('SELECT candidate.user_type')) {
        return { rows: duplicate ? [{ user_type: 'supplier_user', id: SUPPLIER_USER_ID }] : [] };
      }
      if (sql.includes("AS user_type") && sql.includes('WHERE') && !sql.includes('candidate')) {
        return { rows: updated ? [updated] : [] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
}

describe('system user administration', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lists every identity type with normalized organization context and UI protections', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          id: PRIMARY_ADMIN_ID,
          user_type: 'platform_admin',
          role: 'system_admin',
          email: ' WAMUYUWAMUNDIA@GMAIL.COM ',
          full_name: 'Primary Admin',
          is_active: true,
          organization_id: null,
          organization_name: null,
          company_id: null,
          company_name: null,
        },
        {
          id: TENANT_USER_ID,
          user_type: 'tenant_user',
          role: 'customer',
          email: 'CUSTOMER@EXAMPLE.COM',
          full_name: 'Customer User',
          is_active: true,
          organization_id: ORGANIZATION_ID,
          organization_name: 'Acme Zambia',
          company_id: null,
          company_name: null,
        },
        {
          id: SUPPLIER_USER_ID,
          user_type: 'supplier_user',
          role: 'supplier_user',
          email: 'SUPPLIER@EXAMPLE.COM',
          full_name: 'Supplier User',
          is_active: false,
          organization_id: null,
          organization_name: null,
          company_id: COMPANY_ID,
          company_name: 'Copperbelt Supplies',
        },
      ],
    });

    const response = await request(app).get('/api/system/users');

    expect(response.statusCode).toBe(200);
    expect(response.body.users).toEqual([
      expect.objectContaining({
        id: PRIMARY_ADMIN_ID,
        email: 'wamuyuwamundia@gmail.com',
        protected: true,
        can_edit_status: false,
        organization: null,
        company: null,
      }),
      expect.objectContaining({
        id: TENANT_USER_ID,
        email: 'customer@example.com',
        protected: false,
        can_edit_status: true,
        organization: { id: ORGANIZATION_ID, name: 'Acme Zambia' },
      }),
      expect.objectContaining({
        id: SUPPLIER_USER_ID,
        email: 'supplier@example.com',
        company: { id: COMPANY_ID, name: 'Copperbelt Supplies' },
      }),
    ]);
  });

  test('allows only system administrators to list users', async () => {
    const response = await request(app)
      .get('/api/system/users')
      .set('x-test-role', 'business_admin');

    expect(response.statusCode).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('allows only system administrators to edit users', async () => {
    const response = await request(app)
      .patch(`/api/system/users/tenant_user/${TENANT_USER_ID}`)
      .set('x-test-role', 'business_admin')
      .send({ full_name: 'Updated Name' });

    expect(response.statusCode).toBe(403);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('normalizes an edit, locks emails, checks all identity tables, and audits safely', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .patch(`/api/system/users/tenant_user/${TENANT_USER_ID}`)
      .send({
        full_name: '  Updated Name  ',
        email: ' UPDATED@EXAMPLE.COM ',
        is_active: false,
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.user).toEqual(expect.objectContaining({
      id: TENANT_USER_ID,
      email: 'updated@example.com',
      full_name: 'Updated Name',
      is_active: false,
      organization: { id: ORGANIZATION_ID, name: 'Acme Zambia' },
    }));
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE tenant_users'),
      ['Updated Name', 'updated@example.com', false, TENANT_USER_ID]
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT candidate.user_type'),
      ['updated@example.com', 'tenant_user', TENANT_USER_ID]
    );
    const lockCalls = client.query.mock.calls
      .filter(([sql]) => sql.includes('pg_advisory_xact_lock'));
    expect(lockCalls.map(([, params]) => params[0])).toEqual([
      'old@example.com',
      'updated@example.com',
    ]);

    const auditCall = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_log'));
    expect(auditCall).toBeDefined();
    const auditDetails = JSON.parse(auditCall[1][5]);
    expect(auditDetails).toEqual({
      changed_fields: ['full_name', 'email', 'is_active'],
      email_changed: true,
      status_changed: true,
    });
    expect(auditCall[1][5]).not.toContain('updated@example.com');
    expect(auditCall[1][5]).not.toContain('Updated Name');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rejects an email used by a different identity and rolls back', async () => {
    const client = makeClient({ duplicate: true });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .patch(`/api/system/users/tenant_user/${TENANT_USER_ID}`)
      .send({ email: 'supplier@example.com' });

    expect(response.statusCode).toBe(409);
    expect(response.body.error).toMatch(/already exists/i);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE tenant_users'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_log'))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('protects the reserved primary system administrator', async () => {
    const client = makeClient({
      existing: {
        id: PRIMARY_ADMIN_ID,
        email: 'wamuyuwamundia@gmail.com',
        full_name: 'Primary Admin',
        role: 'system_admin',
        is_active: true,
      },
    });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .patch(`/api/system/users/platform_admin/${PRIMARY_ADMIN_ID}`)
      .send({ email: 'replacement@example.com' });

    expect(response.statusCode).toBe(403);
    expect(response.body.error).toMatch(/primary system administrator email/i);
    expect(client.query).toHaveBeenCalledWith('LOCK TABLE platform_admins IN EXCLUSIVE MODE');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('prevents deactivation of the reserved primary system administrator', async () => {
    const client = makeClient({
      existing: {
        id: PRIMARY_ADMIN_ID,
        email: 'wamuyuwamundia@gmail.com',
        full_name: 'Primary Admin',
        role: 'system_admin',
        is_active: true,
      },
    });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .patch(`/api/system/users/platform_admin/${PRIMARY_ADMIN_ID}`)
      .send({ is_active: false });

    expect(response.statusCode).toBe(403);
    expect(response.body.error).toMatch(/cannot deactivate the primary/i);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('prevents an administrator from deactivating their own account', async () => {
    const client = makeClient({
      existing: {
        id: BUSINESS_ADMIN_ID,
        email: 'business.admin@example.com',
        full_name: 'Business Admin',
        role: 'business_admin',
        is_active: true,
      },
    });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .patch(`/api/system/users/platform_admin/${BUSINESS_ADMIN_ID}`)
      .set('x-test-user-id', BUSINESS_ADMIN_ID)
      .send({ is_active: false });

    expect(response.statusCode).toBe(403);
    expect(response.body.error).toMatch(/your own account/i);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('preserves the single active seat for each platform administrator role', async () => {
    const client = makeClient({
      existing: {
        id: BUSINESS_ADMIN_ID,
        email: 'inactive.admin@example.com',
        full_name: 'Inactive Business Admin',
        role: 'business_admin',
        is_active: false,
      },
      activeSeat: true,
    });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .patch(`/api/system/users/platform_admin/${BUSINESS_ADMIN_ID}`)
      .send({ is_active: true });

    expect(response.statusCode).toBe(403);
    expect(response.body.error).toMatch(/already has an active administrator/i);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE role = $1 AND is_active = true'),
      ['business_admin', BUSINESS_ADMIN_ID]
    );
  });

  test('returns 404 and rolls back when the requested identity no longer exists', async () => {
    const client = makeClient({ existing: null });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .patch(`/api/system/users/tenant_user/${TENANT_USER_ID}`)
      .send({ full_name: 'Updated Name' });

    expect(response.statusCode).toBe(404);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('does not update timestamps or audit when requested values are unchanged', async () => {
    const unchanged = {
      id: TENANT_USER_ID,
      user_type: 'tenant_user',
      role: 'customer',
      email: 'old@example.com',
      full_name: 'Old Name',
      is_active: true,
      organization_id: ORGANIZATION_ID,
      organization_name: 'Acme Zambia',
      company_id: null,
      company_name: null,
    };
    const client = makeClient({ existing: unchanged, updated: unchanged });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .patch(`/api/system/users/tenant_user/${TENANT_USER_ID}`)
      .send({
        full_name: 'Old Name',
        email: ' OLD@EXAMPLE.COM ',
        is_active: true,
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toMatch(/no changes/i);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE tenant_users'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_log'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('updated_at'))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('updates platform_admins.updated_at only when a unified edit changes data', async () => {
    const client = makeClient({
      existing: {
        id: BUSINESS_ADMIN_ID,
        email: 'business.admin@example.com',
        full_name: 'Old Admin Name',
        role: 'business_admin',
        is_active: true,
      },
      updated: {
        id: BUSINESS_ADMIN_ID,
        user_type: 'platform_admin',
        role: 'business_admin',
        email: 'business.admin@example.com',
        full_name: 'New Admin Name',
        is_active: true,
        organization_id: null,
        organization_name: null,
        company_id: null,
        company_name: null,
      },
    });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .patch(`/api/system/users/platform_admin/${BUSINESS_ADMIN_ID}`)
      .send({ full_name: 'New Admin Name' });

    expect(response.statusCode).toBe(200);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE platform_admins[\s\S]*updated_at = now\(\)/),
      ['New Admin Name', BUSINESS_ADMIN_ID]
    );
  });

  test('rolls back a failed unified update and returns a controlled error', async () => {
    const client = makeClient();
    const baseQuery = client.query.getMockImplementation();
    client.query.mockImplementation(async (sql, params) => {
      if (sql.includes('UPDATE tenant_users')) throw new Error('database write failed');
      return baseQuery(sql, params);
    });
    pool.connect.mockResolvedValue(client);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .patch(`/api/system/users/tenant_user/${TENANT_USER_ID}`)
      .send({ full_name: 'Updated Name' });

    expect(response.statusCode).toBe(500);
    expect(response.body.error).toBe('Failed to update user');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  test('hardens the legacy admin update with normalization, uniqueness, and audit', async () => {
    const client = makeClient({
      existing: {
        id: BUSINESS_ADMIN_ID,
        email: 'old.admin@example.com',
        full_name: 'Old Admin',
        role: 'business_admin',
        is_active: true,
        password_hash: 'existing-hash',
      },
    });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .put(`/api/system/admins/${BUSINESS_ADMIN_ID}`)
      .send({ full_name: 'New Admin', email: ' NEW.ADMIN@EXAMPLE.COM ' });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE platform_admins SET[\s\S]*updated_at = now\(\)/),
      ['new.admin@example.com', 'New Admin', BUSINESS_ADMIN_ID]
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT candidate.user_type'),
      ['new.admin@example.com', 'platform_admin', BUSINESS_ADMIN_ID]
    );
    const auditCall = client.query.mock.calls.find(([sql]) => (
      sql.includes("'platform_admin_updated'")
    ));
    expect(JSON.parse(auditCall[1][4])).toEqual({
      changed_fields: ['email', 'full_name'],
      email_changed: true,
      status_changed: false,
    });
  });

  test('blocks cross-table duplicate email through the legacy admin update', async () => {
    const client = makeClient({
      existing: {
        id: BUSINESS_ADMIN_ID,
        email: 'old.admin@example.com',
        full_name: 'Old Admin',
        role: 'business_admin',
        is_active: true,
        password_hash: 'existing-hash',
      },
      duplicate: true,
    });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .put(`/api/system/admins/${BUSINESS_ADMIN_ID}`)
      .send({ email: 'supplier@example.com' });

    expect(response.statusCode).toBe(409);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE platform_admins'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_log'))).toBe(false);
  });

  test('protects the primary administrator through the legacy delete endpoint', async () => {
    const client = makeClient({
      existing: {
        id: PRIMARY_ADMIN_ID,
        email: ' WAMUYUWAMUNDIA@GMAIL.COM ',
        role: 'system_admin',
        is_active: true,
      },
    });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .delete(`/api/system/admins/${PRIMARY_ADMIN_ID}`);

    expect(response.statusCode).toBe(403);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE platform_admins'))).toBe(false);
  });

  test.each([
    ['unsupported user type', `/api/system/users/customer/${TENANT_USER_ID}`, { full_name: 'Name' }],
    ['invalid user id', '/api/system/users/tenant_user/not-a-uuid', { full_name: 'Name' }],
    ['unknown update field', `/api/system/users/tenant_user/${TENANT_USER_ID}`, { role: 'system_admin' }],
    ['invalid email', `/api/system/users/tenant_user/${TENANT_USER_ID}`, { email: 'not-an-email' }],
    ['non-boolean status', `/api/system/users/tenant_user/${TENANT_USER_ID}`, { is_active: 'false' }],
    ['overlong full name', `/api/system/users/tenant_user/${TENANT_USER_ID}`, { full_name: 'x'.repeat(151) }],
  ])('rejects %s before opening a transaction', async (_label, url, body) => {
    const response = await request(app).patch(url).send(body);

    expect(response.statusCode).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
