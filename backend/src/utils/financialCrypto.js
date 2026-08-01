const crypto = require('crypto');

function encryptionKey() {
  const value = process.env.PAYMENT_DATA_ENCRYPTION_KEY;
  if (!value) throw new Error('PAYMENT_DATA_ENCRYPTION_KEY is not configured');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32) {
    throw new Error('PAYMENT_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return decoded;
}

function encryptDestination(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptDestination(value) {
  const [version, iv, tag, ciphertext] = String(value).split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Invalid encrypted destination');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encryptDestination, decryptDestination };
