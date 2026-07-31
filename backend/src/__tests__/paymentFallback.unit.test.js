jest.mock('../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));
jest.mock('../services/payments/mtnMomoService', () => ({
  getPaymentStatus: jest.fn(),
  requestToPay: jest.fn(),
}));
jest.mock('../services/payments/airtelMoneyService', () => ({}));
jest.mock('../services/payments/zamtelKwachaService', () => ({}));
jest.mock('../services/ledgerService', () => ({ recordEscrowFunding: jest.fn() }));

const pool = require('../config/db');
const mtn = require('../services/payments/mtnMomoService');
const { syncPaymentStatus } = require('../services/payments/paymentService');

describe('payment gateway fallback', () => {
  test('keeps a payment pending when provider polling fails', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      id: 'payment', provider: 'mtn', provider_reference: 'provider-ref', status: 'pending',
    }] });
    mtn.getPaymentStatus.mockRejectedValueOnce(new Error('gateway timeout'));
    await expect(syncPaymentStatus('payment')).resolves.toBe('pending');
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
