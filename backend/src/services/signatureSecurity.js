const crypto = require('crypto');

const SIGNATURE_VERSION = 2;

function deriveSignatureKey(secret) {
  if (!secret) throw new Error('A signature secret is required');
  return crypto.createHmac('sha256', secret).update('freshstart:digital-signature:v2').digest();
}

function documentHash(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function isoDate(value) {
  return new Date(value).toISOString();
}

function signaturePayload(signature) {
  return JSON.stringify({
    version: SIGNATURE_VERSION,
    documentType: signature.document_type,
    documentId: signature.document_id,
    documentHash: signature.document_hash,
    signerUserId: signature.signer_user_id,
    signerUserType: signature.signer_user_type,
    signerRole: signature.signer_role || null,
    signerEmail: signature.signer_email || null,
    signerName: signature.signer_name,
    signerTitle: signature.signer_title || null,
    consentText: signature.consent_text,
    signedAt: isoDate(signature.signed_at),
  });
}

function createSignatureHash(signature, key) {
  return crypto.createHmac('sha256', key).update(signaturePayload(signature)).digest('hex');
}

function hashesMatch(left, right) {
  if (!/^[0-9a-f]{64}$/i.test(left || '') || !/^[0-9a-f]{64}$/i.test(right || '')) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

module.exports = {
  SIGNATURE_VERSION,
  deriveSignatureKey,
  documentHash,
  createSignatureHash,
  hashesMatch,
  signaturePayload,
};
