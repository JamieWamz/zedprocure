const crypto = require('crypto');
const { encryptDestination, decryptDestination } = require('../utils/financialCrypto');

describe('financial destination encryption', () => {
  beforeEach(() => {
    process.env.PAYMENT_DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  });

  afterEach(() => delete process.env.PAYMENT_DATA_ENCRYPTION_KEY);

  test('round-trips payout destinations with authenticated encryption', () => {
    const plaintext = '260971234567';
    const encrypted = encryptDestination(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptDestination(encrypted)).toBe(plaintext);
  });

  test('rejects ciphertext tampering', () => {
    const encrypted = encryptDestination('260971234567');
    const tampered = encrypted.slice(0, -1) + (encrypted.endsWith('A') ? 'B' : 'A');
    expect(() => decryptDestination(tampered)).toThrow();
  });

  test('requires a 256-bit production key', () => {
    process.env.PAYMENT_DATA_ENCRYPTION_KEY = Buffer.from('short').toString('base64');
    expect(() => encryptDestination('260971234567')).toThrow('32-byte');
  });
});
