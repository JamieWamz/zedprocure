const {
  deriveSignatureKey, documentHash, createSignatureHash, hashesMatch,
} = require('../services/signatureSecurity');

const signature = {
  document_type: 'order',
  document_id: '95a8cf57-59b6-40ff-9535-b2be928c2ad2',
  document_hash: documentHash({ id: 'order-1', total: '1250.00', status: 'accepted' }),
  signer_user_id: 'd5e6a149-7641-4d61-9b35-eb74f1b0ef72',
  signer_user_type: 'tenant_user',
  signer_role: 'customer',
  signer_email: 'buyer@example.com',
  signer_name: 'Test Buyer',
  signer_title: 'Procurement Officer',
  consent_text: 'Consent text',
  signed_at: '2026-08-01T10:00:00.000Z',
};

describe('tamper-evident digital signature security', () => {
  const key = deriveSignatureKey('test-secret-with-enough-entropy');

  test('verifies an unchanged canonical signature payload', () => {
    const digest = createSignatureHash(signature, key);
    expect(hashesMatch(digest, createSignatureHash(signature, key))).toBe(true);
  });

  test('detects changes to signed identity or document fingerprint', () => {
    const digest = createSignatureHash(signature, key);
    expect(hashesMatch(digest, createSignatureHash({ ...signature, signer_name: 'Another Person' }, key))).toBe(false);
    expect(hashesMatch(digest, createSignatureHash({ ...signature, document_hash: documentHash({ id: 'order-1', total: '1500.00' }) }, key))).toBe(false);
  });

  test('uses distinct keys for distinct application secrets', () => {
    const first = createSignatureHash(signature, key);
    const second = createSignatureHash(signature, deriveSignatureKey('different-secret'));
    expect(hashesMatch(first, second)).toBe(false);
  });
});
