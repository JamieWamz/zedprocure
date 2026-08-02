const express = require('express');
const request = require('supertest');

jest.mock('../config/db', () => ({ query: jest.fn() }));
jest.mock('../config/auth', () => ({
  jwtSecret: 'test-secret-that-is-long-enough',
  ACCESS_TTL: '15m',
  REFRESH_TTL: '7d',
  cookieOptions: { httpOnly: true, sameSite: 'lax', path: '/' },
  TOKEN_COOKIE: 'token',
  REFRESH_COOKIE: 'refresh_token',
}));
jest.mock('bcryptjs', () => ({ compare: jest.fn() }));
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn((_payload, _secret, options) => `${options.expiresIn}-token`),
  verify: jest.fn(),
}));

const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const authRouter = require('../routes/auth');

const USER_ID = '00000000-0000-4000-8000-000000000001';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

describe('authentication identity resolution', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('authenticates exactly one normalized identity across all identity tables', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: USER_ID,
          email: 'customer@example.com',
          password_hash: 'stored-hash',
          full_name: 'Customer User',
          user_type: 'tenant_user',
          role: 'customer',
          tenant_id: '00000000-0000-4000-8000-000000000002',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    bcrypt.compare.mockResolvedValue(true);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: ' CUSTOMER@EXAMPLE.COM ', password: 'SecurePass1!' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(pool.query.mock.calls[0]).toEqual([
      expect.stringMatching(/FROM platform_admins[\s\S]*UNION ALL[\s\S]*FROM tenant_users[\s\S]*UNION ALL[\s\S]*FROM supplier_users/),
      ['customer@example.com'],
    ]);
    expect(pool.query.mock.calls[0][0]).toContain('LOWER(BTRIM(email))');
    expect(bcrypt.compare).toHaveBeenCalledWith('SecurePass1!', 'stored-hash');
    expect(response.headers['set-cookie']).toHaveLength(2);
  });

  test('rejects ambiguous normalized identities without checking any password', async () => {
    pool.query.mockResolvedValue({
      rows: [
        { id: USER_ID, user_type: 'tenant_user', password_hash: 'first' },
        { id: '00000000-0000-4000-8000-000000000003', user_type: 'supplier_user', password_hash: 'second' },
      ],
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'duplicate@example.com', password: 'SecurePass1!' });

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid credentials' });
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  test('uses the same generic credential error when no identity matches', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'missing@example.com', password: 'SecurePass1!' });

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid credentials' });
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('returns a controlled error when identity lookup is unavailable', async () => {
    pool.query.mockRejectedValue(new Error('database unavailable'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'SecurePass1!' });

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'Login is temporarily unavailable' });
    consoleSpy.mockRestore();
  });
});
