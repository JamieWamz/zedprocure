jest.mock('../services/walletService', () => ({
  ensureWallet: jest.fn(),
  debitWallet: jest.fn(),
}));

const { ensureWallet, debitWallet } = require('../services/walletService');
const { consumeBidAccess } = require('../services/bidFeeService');

function clientWith(responses) {
  return { query: jest.fn(async () => ({ rows: [responses.shift()].filter(Boolean) })) };
}

const context = {
  bid_id: 'bid', bidding_fee_amount: '25.00', status: 'open',
  deadline: new Date(Date.now() + 60_000), supplier_id: 'supplier', verification_status: 'verified',
};

describe('atomic bid access charging', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns an existing completed charge without a second debit', async () => {
    const existing = { id: 'charge', status: 'completed', charge_source: 'wallet' };
    const client = clientWith([context, existing]);
    await expect(consumeBidAccess({ bidId: 'bid', supplierUserId: 'user', client })).resolves.toBe(existing);
    expect(debitWallet).not.toHaveBeenCalled();
  });

  test('rejects submission when no payment, credit, or subscription allowance exists', async () => {
    const client = clientWith([context, null, null]);
    await expect(consumeBidAccess({ bidId: 'bid', supplierUserId: 'user', client }))
      .rejects.toMatchObject({ code: 'PAYMENT_REQUIRED' });
  });

  test('consumes one subscription allowance under the caller transaction', async () => {
    const subscription = {
      id: 'sub', bids_used: 1, monthly_bid_limit: 2, bid_credits: 0,
      period_end: new Date(Date.now() + 60_000),
    };
    const charge = { id: 'charge', status: 'completed', charge_source: 'subscription' };
    const client = clientWith([context, null, subscription, null, charge]);
    await expect(consumeBidAccess({ bidId: 'bid', supplierUserId: 'user', client })).resolves.toEqual(charge);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('bids_used = bids_used + 1'))).toBe(true);
    expect(debitWallet).not.toHaveBeenCalled();
  });

  test('uses the locked wallet for an explicit pay-as-you-go transaction', async () => {
    const payment = { id: 'payment', amount: '25.00', status: 'initiated' };
    const charge = { id: 'charge', status: 'completed', charge_source: 'wallet', amount: '25.00' };
    const client = clientWith([context, null, null, payment, charge]);
    ensureWallet.mockResolvedValue({ id: 'wallet', balance: '25.00' });
    debitWallet.mockResolvedValue({ balanceBefore: 25, balanceAfter: 0 });
    await consumeBidAccess({
      bidId: 'bid', supplierUserId: 'user', paymentTransactionId: 'payment', client,
    });
    expect(ensureWallet).toHaveBeenCalledWith('user', 'supplier_user', client);
    expect(debitWallet).toHaveBeenCalledWith(
      'wallet', 25, expect.any(String), client,
      expect.objectContaining({ type: 'payment' })
    );
  });
});
