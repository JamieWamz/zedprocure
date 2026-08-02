const express = require('express');
const request = require('supertest');

jest.mock('../config/db', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hashed-password') }));
jest.mock('../services/emailService', () => ({
  sendPasswordReset: jest.fn(),
  sendWelcome: jest.fn(async () => undefined),
  sendInvitation: jest.fn(),
}));

const pool = require('../config/db');
const { sendWelcome } = require('../services/emailService');
const registrationRouter = require('../routes/registration');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', registrationRouter);
  return app;
}

function makeClient({ existingEmail = false } = {}) {
  return {
    query: jest.fn(async (sql, params = []) => {
      if (sql.includes('SELECT email FROM')) return { rows: existingEmail ? [{ email: params[0] }] : [] };
      if (sql.includes('INSERT INTO tenant_users')) {
        return { rows: [{ id: 'customer-user-id', email: params[2], full_name: params[4], role: 'customer' }] };
      }
      if (sql.includes('INSERT INTO supplier_users')) {
        return { rows: [{ id: 'supplier-user-id', email: params[2], full_name: params[4] }] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
}

describe('self-service registration', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
    sendWelcome.mockResolvedValue(undefined);
  });

  it('creates a customer organization and customer identity atomically', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);

    const response = await request(app).post('/api/register').send({
      account_type: 'customer',
      full_name: '  Jane Banda  ',
      email: '  JANE@EXAMPLE.COM ',
      organization: 'Acme Zambia',
      registration_number: 'PACRA-100',
      password: 'SecurePass1!',
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({
      account_type: 'customer',
      email: 'jane@example.com',
      full_name: 'Jane Banda',
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tenants'),
      expect.arrayContaining([expect.any(String), 'Acme Zambia', 'PACRA-100'])
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('creates a pending supplier identity that can continue verification', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);

    const response = await request(app).post('/api/register').send({
      account_type: 'supplier',
      full_name: 'John Phiri',
      email: 'supplier@example.com',
      organization: 'Phiri Supplies Ltd',
      password: 'SecurePass1!',
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({
      account_type: 'supplier',
      email: 'supplier@example.com',
      supplier_status: 'pending',
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO suppliers'),
      expect.arrayContaining([expect.any(String), 'Phiri Supplies Ltd', null])
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('rejects duplicate emails case-insensitively', async () => {
    const client = makeClient({ existingEmail: true });
    pool.connect.mockResolvedValue(client);

    const response = await request(app).post('/api/register').send({
      account_type: 'customer',
      full_name: 'Jane Banda',
      email: 'JANE@example.com',
      organization: 'Acme Zambia',
      password: 'SecurePass1!',
    });

    expect(response.statusCode).toBe(409);
    expect(response.body.error).toMatch(/already exists/i);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('uses the same strong-password policy exposed by the UI', async () => {
    const response = await request(app).post('/api/register').send({
      account_type: 'supplier',
      full_name: 'John Phiri',
      email: 'supplier@example.com',
      organization: 'Phiri Supplies Ltd',
      password: 'password',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toMatch(/at least 10 characters/i);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('does not fail a committed registration when welcome email delivery fails', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);
    sendWelcome.mockRejectedValue(new Error('SMTP unavailable'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app).post('/api/register').send({
      account_type: 'customer',
      full_name: 'Jane Banda',
      email: 'jane@example.com',
      organization: 'Acme Zambia',
      password: 'SecurePass1!',
    });

    expect(response.statusCode).toBe(201);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(sendWelcome).toHaveBeenCalledWith('jane@example.com', 'Jane Banda');
    consoleSpy.mockRestore();
  });

  it('returns a controlled error when the database is unavailable', async () => {
    pool.connect.mockRejectedValue(new Error('database unavailable'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app).post('/api/register').send({
      account_type: 'supplier',
      full_name: 'John Phiri',
      email: 'supplier@example.com',
      organization: 'Phiri Supplies Ltd',
      password: 'SecurePass1!',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body.error).toBe('Registration could not be completed');
    consoleSpy.mockRestore();
  });
});
