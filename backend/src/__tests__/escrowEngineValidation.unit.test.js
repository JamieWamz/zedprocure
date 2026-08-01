jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/distributedLock', () => ({ withFinancialLock: jest.fn() }));
jest.mock('../services/ledgerService', () => ({
  recordEscrowFunding: jest.fn(), recordSubsidyFunding: jest.fn(),
  recordEscrowRelease: jest.fn(), recordEscrowRefund: jest.fn(),
}));

const { money, maskLast4, safeProviderPayload } = require('../services/escrowEngine');

describe('escrow financial validation', () => {
  test.each([
    [1, '1.00'], ['25.5', '25.50'], ['0.01', '0.01'],
  ])('normalizes %s to two-decimal money', (input, expected) => {
    expect(money(input)).toBe(expected);
  });

  test.each([0, -1, 'not-a-number', Infinity])('rejects invalid amount %s', input => {
    expect(() => money(input)).toThrow('positive');
  });

  test('returns only a destination last-four mask', () => {
    expect(maskLast4('+260 971 234567')).toBe('4567');
  });

  test('redacts common provider PII before persistence', () => {
    expect(safeProviderPayload({ status: 'SUCCESSFUL', payer: { partyId: '260971234567' } }))
      .toEqual({ status: 'SUCCESSFUL', payer: '[REDACTED]' });
  });
});
