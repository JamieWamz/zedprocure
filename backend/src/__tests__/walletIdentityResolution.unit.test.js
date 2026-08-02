const express = require('express');
const request = require('supertest');

jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../middleware/authMiddleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000001',
      user_id: '00000000-0000-4000-8000-000000000001',
      user_type: 'tenant_user',
      role: 'customer',
      email: 'sender@example.com',
    };
    next();
  },
}));
jest.mock('../services/walletService', () => ({ debitWallet: jest.fn() }));
jest.mock('../services/monetizationService', () => {
  class MonetizationError extends Error {}
  return {
    calculateWithdrawal: jest.fn(),
    MonetizationError,
  };
});

const pool = require('../config/db');
const walletRouter = require('../routes/wallet');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/wallet', walletRouter);
  return app;
}

function makeClient({
  sender = { id: 'sender-wallet', balance: '100.00' },
  recipientMatches = [{
    identity_id: 'recipient-user',
    user_type: 'supplier_user',
    wallet_id: 'recipient-wallet',
    balance: '10.00',
  }],
  recipient = {
    id: 'recipient-wallet',
    user_id: 'recipient-user',
    user_type: 'supplier_user',
    balance: '10.00',
  },
  failWrite = false,
  failRollback = false,
} = {}) {
  return {
    query: jest.fn(async sql => {
      if (sql === 'ROLLBACK' && failRollback) throw new Error('rollback unavailable');
      if (sql.includes('SELECT * FROM wallets')) return { rows: sender ? [sender] : [] };
      if (sql.includes('SELECT identities.id AS identity_id')) return { rows: recipientMatches };
      if (sql.includes('FROM wallets WHERE id = $1 FOR UPDATE')) {
        return { rows: recipient ? [recipient] : [] };
      }
      if (failWrite && sql.includes('INSERT INTO wallet_transactions')) {
        throw new Error('write failed');
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
}

describe('wallet recipient identity resolution', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('transfers only when one active identity maps to one wallet', async () => {
    const client = makeClient();
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .post('/api/wallet/transfer')
      .send({ to_email: ' RECIPIENT@EXAMPLE.COM ', amount: 25 });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: 'Transfer completed', balance: '75.00' });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT identities.id AS identity_id'),
      ['recipient@example.com']
    );
    expect(client.query).toHaveBeenCalledWith(
      'SELECT id, user_id, user_type, balance FROM wallets WHERE id = $1 FOR UPDATE',
      ['recipient-wallet']
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back with 409 instead of choosing an ambiguous recipient', async () => {
    const client = makeClient({
      recipientMatches: [
        { identity_id: 'first', user_type: 'tenant_user', wallet_id: 'first-wallet' },
        { identity_id: 'second', user_type: 'supplier_user', wallet_id: 'second-wallet' },
      ],
    });
    pool.connect.mockResolvedValue(client);

    const response = await request(app)
      .post('/api/wallet/transfer')
      .send({ to_email: 'duplicate@example.com', amount: 25 });

    expect(response.statusCode).toBe(409);
    expect(response.body.error).toMatch(/multiple accounts/i);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO wallet_transactions')))
      .toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('returns a controlled error when a database connection cannot be acquired', async () => {
    pool.connect.mockRejectedValue(new Error('database unavailable'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post('/api/wallet/transfer')
      .send({ to_email: 'recipient@example.com', amount: 25 });

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'Transfer failed' });
    consoleSpy.mockRestore();
  });

  test('preserves the controlled response and releases the client when rollback also fails', async () => {
    const client = makeClient({ failWrite: true, failRollback: true });
    pool.connect.mockResolvedValue(client);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post('/api/wallet/transfer')
      .send({ to_email: 'recipient@example.com', amount: 25 });

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'Transfer failed' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
