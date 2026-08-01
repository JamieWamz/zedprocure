const { randomUUID, randomBytes } = require('crypto');

jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/distributedLock', () => ({
  withFinancialLock: jest.fn((_key, fn) => fn()),
}));
jest.mock('../services/payments/paymentProviderRegistry', () => ({
  normalizeProvider: jest.fn(value => String(value).toUpperCase()),
  collect: jest.fn(),
  disburse: jest.fn(),
  queryTransaction: jest.fn(),
}));
jest.mock('../services/ledgerService', () => ({
  recordEscrowFunding: jest.fn(), recordSubsidyFunding: jest.fn(),
  recordEscrowRelease: jest.fn(), recordEscrowRefund: jest.fn(),
}));

const pool = require('../config/db');
const providers = require('../services/payments/paymentProviderRegistry');
const { createCollection } = require('../services/escrowEngine');

describe('escrow collection creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENT_DATA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.NODE_ENV = 'test';
    process.env.DEMO_MODE = 'false';
  });

  afterEach(() => delete process.env.PAYMENT_DATA_ENCRYPTION_KEY);

  test('persists server-authoritative pricing before calling the provider', async () => {
    const orderId = randomUUID();
    const buyerId = randomUUID();
    const tenantId = randomUUID();
    const sellerId = randomUUID();
    const escrowId = randomUUID();
    const paymentLogId = randomUUID();
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{
        id: orderId, tenant_id: tenantId, awarded_supplier_id: sellerId,
        total_amount: '112.50', supplier_payout_amount: '100.00', platform_revenue_amount: '12.50',
        status: 'accepted',
      }] })
      .mockResolvedValueOnce({ rows: [] }) // no prior escrow
      .mockImplementationOnce((_sql, values) => Promise.resolve({ rows: [{
        id: escrowId, order_id: orderId, transaction_ref: values[1],
        status: 'INITIATED', version: 1,
      }] }))
      .mockImplementationOnce((_sql, values) => Promise.resolve({ rows: [{
        id: escrowId, order_id: orderId, transaction_ref: values[1],
        status: 'PAYMENT_PENDING', version: 2,
      }] }))
      .mockResolvedValueOnce({ rows: [] }) // order projection
      .mockResolvedValueOnce({ rows: [] }) // transition audit
      .mockResolvedValueOnce({ rows: [{ id: paymentLogId }] })
      .mockResolvedValueOnce({}); // COMMIT
    pool.connect.mockResolvedValue(client);
    providers.collect.mockImplementation((_provider, request) => Promise.resolve({ reference: request.reference }));

    const result = await createCollection({
      orderId,
      provider: 'mtn',
      destination: '260971234567',
      buyer: { user_id: buyerId, user_type: 'tenant_user', tenant_id: tenantId },
      description: 'Order payment',
      correlationId: randomUUID(),
    });

    const insertCall = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO escrow_transactions'));
    expect(insertCall[1]).toEqual(expect.arrayContaining(['112.50', '12.50', '100.00']));
    expect(providers.collect).toHaveBeenCalledWith('MTN', expect.objectContaining({
      amount: '112.50', destination: '260971234567', orderId,
    }));
    expect(result).toMatchObject({ paymentLogId, escrowTransactionId: escrowId, status: 'PAYMENT_PENDING' });
    expect(client.release).toHaveBeenCalled();
  });

  test('rejects a simultaneous collection when one is already pending', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{
        id: randomUUID(), tenant_id: 'tenant', awarded_supplier_id: randomUUID(),
        total_amount: '10.00', supplier_payout_amount: '9.00', status: 'accepted',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: randomUUID(), status: 'PAYMENT_PENDING' }] })
      .mockResolvedValueOnce({});
    pool.connect.mockResolvedValue(client);

    await expect(createCollection({
      orderId: randomUUID(), provider: 'mtn', destination: '260971234567',
      buyer: { user_id: randomUUID(), user_type: 'tenant_user', tenant_id: 'tenant' },
      description: 'Order payment', correlationId: randomUUID(),
    })).rejects.toMatchObject({ status: 409 });
    expect(providers.collect).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
});
