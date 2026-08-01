const crypto = require('crypto');

jest.mock('../services/payments/mtnMomoService', () => ({
  requestToPay: jest.fn(), transfer: jest.fn(), getTransactionStatus: jest.fn(),
}));
jest.mock('../services/payments/airtelMoneyService', () => ({
  pay: jest.fn(), disburse: jest.fn(), queryTransaction: jest.fn(),
}));
jest.mock('../services/payments/bankPaymentService', () => ({
  collect: jest.fn(), disburse: jest.fn(), queryTransaction: jest.fn(),
}));

const registry = require('../services/payments/paymentProviderRegistry');

describe('payment provider registry', () => {
  afterEach(() => {
    delete process.env.MTN_WEBHOOK_SECRET;
    delete process.env.MTN_WEBHOOK_TOKEN;
  });

  test('normalizes supported rails and rejects unknown providers', () => {
    expect(registry.normalizeProvider('mtn')).toBe('MTN');
    expect(registry.normalizeProvider(' Airtel ')).toBe('AIRTEL');
    expect(registry.normalizeProvider('bank')).toBe('BANK');
    expect(() => registry.normalizeProvider('unknown')).toThrow('Unsupported');
  });

  test.each([
    ['SUCCESSFUL', 'SUCCEEDED'], ['TS', 'SUCCEEDED'], ['COMPLETED', 'SUCCEEDED'],
    ['FAILED', 'FAILED'], ['TF', 'FAILED'], ['REJECTED', 'FAILED'], ['TP', 'PENDING'],
  ])('maps provider status %s to %s', (input, expected) => {
    expect(registry.normalizeStatus('MTN', { status: input })).toBe(expected);
  });

  test('verifies HMAC over the exact raw request bytes', () => {
    process.env.MTN_WEBHOOK_SECRET = 'test-webhook-secret';
    const raw = Buffer.from('{"status":"SUCCESSFUL","externalId":"abc"}');
    const signature = crypto.createHmac('sha256', process.env.MTN_WEBHOOK_SECRET).update(raw).digest('hex');
    expect(registry.verifyWebhook('MTN', raw, { 'x-webhook-signature': `sha256=${signature}` })).toBe(true);
    expect(registry.verifyWebhook('MTN', Buffer.from('{}'), { 'x-webhook-signature': signature })).toBe(false);
  });

  test('supports a constant-time bearer token for providers without signed callbacks', () => {
    process.env.MTN_WEBHOOK_TOKEN = 'provider-callback-token';
    expect(registry.verifyWebhook('MTN', Buffer.from('{}'), {
      authorization: 'Bearer provider-callback-token',
    })).toBe(true);
    expect(registry.verifyWebhook('MTN', Buffer.from('{}'), { authorization: 'Bearer wrong' })).toBe(false);
  });

  test('uses payload digest in the idempotency key', () => {
    const first = registry.webhookIdempotencyKey('MTN', { id: 'evt-1' }, {}, Buffer.from('{"id":"evt-1","status":"PENDING"}'));
    const second = registry.webhookIdempotencyKey('MTN', { id: 'evt-1' }, {}, Buffer.from('{"id":"evt-1","status":"SUCCESSFUL"}'));
    expect(first).not.toBe(second);
  });

  test('normalizes Airtel transaction webhooks', () => {
    expect(registry.normalizeWebhook('airtel', {
      transaction: { id: 'airtel-123', status: 'TS' }, type: 'DISBURSEMENT',
    })).toMatchObject({ reference: 'airtel-123', operation: 'disbursement', status: 'SUCCEEDED' });
  });
});
