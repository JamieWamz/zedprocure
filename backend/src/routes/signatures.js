const bcrypt = require('bcryptjs');
const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
const { jwtSecret } = require('../config/auth');
const { authenticate } = require('../middleware/authMiddleware');
const { financialNoStore, requireJsonMutation } = require('../middleware/financialSecurity');
const {
  SIGNATURE_VERSION, deriveSignatureKey, documentHash, createSignatureHash, hashesMatch,
} = require('../services/signatureSecurity');

const router = express.Router();
const DOCUMENT_TYPES = new Set(['invoice', 'order', 'bid']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const CONSENT_TEXT = 'I agree to sign this document electronically and understand this digital signature represents my approval.';
const signatureSecret = process.env.SIGNATURE_SECRET || jwtSecret;
const signatureKey = deriveSignatureKey(signatureSecret);

const signatureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signature attempts. Please wait before trying again.' },
});

router.use(financialNoStore, requireJsonMutation);

function isPlatformAdmin(user) {
  return user.user_type === 'platform_admin' && ['business_admin', 'system_admin'].includes(user.role);
}

function normalizeName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

async function supplierIdForUser(client, userId) {
  const { rows: [supplier] } = await client.query('SELECT supplier_id FROM supplier_users WHERE id = $1', [userId]);
  return supplier?.supplier_id || null;
}

async function canAccessDocument(client, user, documentType, documentId) {
  if (isPlatformAdmin(user)) return true;

  if (documentType === 'invoice') {
    const { rows: [invoice] } = await client.query('SELECT party_type, party_id, party_email FROM invoices WHERE id = $1', [documentId]);
    if (!invoice) return false;
    if (user.user_type === 'tenant_user') {
      return invoice.party_type === 'customer' && (
        invoice.party_id === user.user_id ||
        String(invoice.party_email || '').toLowerCase() === String(user.email || '').toLowerCase()
      );
    }
    if (user.user_type === 'supplier_user') {
      const supplierId = await supplierIdForUser(client, user.user_id);
      return invoice.party_type === 'supplier' && (
        invoice.party_id === supplierId ||
        String(invoice.party_email || '').toLowerCase() === String(user.email || '').toLowerCase()
      );
    }
    return false;
  }

  if (documentType === 'order') {
    const { rows: [order] } = await client.query(
      `SELECT o.awarded_supplier_id, b.tenant_id
       FROM orders o JOIN bids b ON b.id = o.bid_id WHERE o.id = $1`,
      [documentId]
    );
    if (!order) return false;
    if (user.user_type === 'tenant_user') return order.tenant_id === user.tenant_id;
    if (user.user_type === 'supplier_user') {
      const supplierId = await supplierIdForUser(client, user.user_id);
      return order.awarded_supplier_id === supplierId;
    }
    return false;
  }

  if (documentType === 'bid') {
    const { rows: [bid] } = await client.query('SELECT tenant_id FROM bids WHERE id = $1', [documentId]);
    return Boolean(bid && user.user_type === 'tenant_user' && bid.tenant_id === user.tenant_id);
  }
  return false;
}

async function loadDocumentSnapshot(client, documentType, documentId, lock = false) {
  const lockClause = lock ? ' FOR SHARE' : '';
  let query;
  if (documentType === 'invoice') {
    query = `SELECT id, invoice_no, type, party_type, party_id, order_id, subtotal, tax_amount,
                    total_amount, paid_amount, currency, status, issue_date, due_date, created_at
             FROM invoices WHERE id = $1${lockClause}`;
  } else if (documentType === 'order') {
    query = `SELECT id, bid_id, awarded_supplier_id, buyer_price, supplier_price, total_amount,
                    supplier_payout_amount, status, created_at
             FROM orders WHERE id = $1${lockClause}`;
  } else {
    query = `SELECT id, tenant_id, title, description, visibility, status, deadline, created_at
             FROM bids WHERE id = $1${lockClause}`;
  }
  const { rows: [row] } = await client.query(query, [documentId]);
  return row || null;
}

async function passwordHashForUser(client, user) {
  const table = user.user_type === 'platform_admin'
    ? 'platform_admins'
    : user.user_type === 'tenant_user' ? 'tenant_users' : 'supplier_users';
  const { rows: [row] } = await client.query(`SELECT password_hash FROM ${table} WHERE id = $1 AND is_active = true`, [user.user_id]);
  return row?.password_hash || null;
}

router.get('/:documentType/:documentId', authenticate, async (req, res) => {
  const { documentType, documentId } = req.params;
  if (!DOCUMENT_TYPES.has(documentType) || !UUID_PATTERN.test(documentId)) {
    return res.status(400).json({ error: 'Invalid document reference' });
  }

  const client = await pool.connect();
  try {
    if (!(await canAccessDocument(client, req.user, documentType, documentId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const snapshot = await loadDocumentSnapshot(client, documentType, documentId);
    if (!snapshot) return res.status(404).json({ error: 'Document not found' });
    const currentDocumentHash = documentHash(snapshot);
    const { rows } = await client.query(
      `SELECT id, document_type, document_id, signer_user_id, signer_user_type, signer_role,
              signer_email, signer_name, signer_title, signature_hash, signature_version,
              document_hash, consent_text, password_verified_at, signed_at
       FROM digital_signatures
       WHERE document_type = $1 AND document_id = $2 ORDER BY signed_at ASC`,
      [documentType, documentId]
    );
    res.json(rows.map(row => {
      const legacy = Number(row.signature_version || 1) < SIGNATURE_VERSION || !row.document_hash;
      const expectedHash = legacy ? null : createSignatureHash(row, signatureKey);
      const safeRow = { ...row };
      delete safeRow.signer_user_id;
      return {
        ...safeRow,
        integrity_verified: legacy ? null : hashesMatch(row.signature_hash, expectedHash),
        document_unchanged: legacy ? null : hashesMatch(row.document_hash, currentDocumentHash),
        integrity_status: legacy ? 'legacy' : 'hmac-sha256-v2',
      };
    }));
  } catch (error) {
    console.error('List signatures error:', error);
    res.status(500).json({ error: 'Failed to load digital signatures' });
  } finally {
    client.release();
  }
});

router.post('/', authenticate, signatureLimiter, async (req, res) => {
  const documentType = cleanText(req.body.document_type, 30).toLowerCase();
  const documentId = cleanText(req.body.document_id, 36).toLowerCase();
  const signerName = cleanText(req.body.signer_name, 150);
  const signerTitle = cleanText(req.body.signer_title, 120);
  const confirmationPassword = typeof req.body.confirmation_password === 'string' ? req.body.confirmation_password : '';

  if (!DOCUMENT_TYPES.has(documentType) || !UUID_PATTERN.test(documentId)) {
    return res.status(400).json({ error: 'Invalid document reference' });
  }
  if (req.body.consent !== true) return res.status(400).json({ error: 'Consent is required to sign electronically' });
  if (!confirmationPassword || confirmationPassword.length > 256) return res.status(400).json({ error: 'Password confirmation is required' });
  if (!req.user.full_name || normalizeName(signerName) !== normalizeName(req.user.full_name)) {
    return res.status(400).json({ error: 'Legal name must match the name on your account' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await passwordHashForUser(client, req.user);
    const passwordValid = passwordHash && await bcrypt.compare(confirmationPassword, passwordHash);
    if (!passwordValid) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Password confirmation failed' });
    }
    if (!(await canAccessDocument(client, req.user, documentType, documentId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden' });
    }
    const snapshot = await loadDocumentSnapshot(client, documentType, documentId, true);
    if (!snapshot) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document not found' });
    }

    const signedAt = new Date().toISOString();
    const signatureRecord = {
      document_type: documentType,
      document_id: documentId,
      document_hash: documentHash(snapshot),
      signer_user_id: req.user.user_id,
      signer_user_type: req.user.user_type,
      signer_role: req.user.role || null,
      signer_email: req.user.email || null,
      signer_name: req.user.full_name.trim(),
      signer_title: signerTitle || null,
      consent_text: CONSENT_TEXT,
      signed_at: signedAt,
    };
    const signatureHash = createSignatureHash(signatureRecord, signatureKey);

    const { rows: [signature] } = await client.query(
      `INSERT INTO digital_signatures
        (document_type, document_id, signer_user_id, signer_user_type, signer_role, signer_email,
         signer_name, signer_title, signature_hash, signature_version, document_hash, consent_text,
         ip_address, user_agent, password_verified_at, signed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),$15)
       RETURNING id, document_type, document_id, signer_user_type, signer_role, signer_email,
                 signer_name, signer_title, signature_hash, signature_version, document_hash,
                 consent_text, password_verified_at, signed_at`,
      [
        documentType, documentId, req.user.user_id, req.user.user_type, req.user.role || null,
        req.user.email || null, signatureRecord.signer_name, signerTitle || null, signatureHash,
        SIGNATURE_VERSION, signatureRecord.document_hash, CONSENT_TEXT, req.ip || null,
        cleanText(req.get('user-agent'), 500) || null, signedAt,
      ]
    );

    await client.query(
      `INSERT INTO audit_log (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1,$2,$3,'digital_signature_applied',$4,$5,$6)`,
      [
        req.user.user_id, req.user.user_type, req.user.email || null, documentType, documentId,
        JSON.stringify({ signature_id: signature.id, signature_version: SIGNATURE_VERSION, document_hash: signature.document_hash }),
      ]
    );
    await client.query('COMMIT');
    res.status(201).json({ ...signature, integrity_verified: true, document_unchanged: true, integrity_status: 'hmac-sha256-v2' });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'You have already signed this document. Signatures cannot be replaced.' });
    console.error('Create signature error:', error);
    res.status(500).json({ error: 'Failed to apply digital signature' });
  } finally {
    client.release();
  }
});

module.exports = router;
