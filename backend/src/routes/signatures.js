const crypto = require('crypto');
const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

const DOCUMENT_TYPES = new Set(['invoice', 'order', 'bid']);
const CONSENT_TEXT = 'I agree to sign this document electronically and understand this digital signature represents my approval.';

function isPlatformAdmin(user) {
  return user.user_type === 'platform_admin' && ['business_admin', 'system_admin'].includes(user.role);
}

async function supplierIdForUser(client, userId) {
  const { rows: [supplier] } = await client.query('SELECT supplier_id FROM supplier_users WHERE id = $1', [userId]);
  return supplier?.supplier_id || null;
}

async function canAccessDocument(client, user, documentType, documentId) {
  if (isPlatformAdmin(user)) return true;

  if (documentType === 'invoice') {
    const { rows: [invoice] } = await client.query('SELECT * FROM invoices WHERE id = $1', [documentId]);
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
      `SELECT o.*, b.tenant_id
       FROM orders o
       JOIN bids b ON b.id = o.bid_id
       WHERE o.id = $1`,
      [documentId]
    );
    if (!order) return false;
    if (user.user_type === 'tenant_user') return order.tenant_id === user.tenant_id;
    if (user.user_type === 'supplier_user') {
      const supplierId = await supplierIdForUser(client, user.user_id);
      return order.awarded_supplier_id === supplierId;
    }
  }

  if (documentType === 'bid') {
    const { rows: [bid] } = await client.query('SELECT tenant_id FROM bids WHERE id = $1', [documentId]);
    if (!bid) return false;
    return user.user_type === 'tenant_user' && bid.tenant_id === user.tenant_id;
  }

  return false;
}

router.get('/:documentType/:documentId', authenticate, async (req, res) => {
  const { documentType, documentId } = req.params;
  if (!DOCUMENT_TYPES.has(documentType)) return res.status(400).json({ error: 'Invalid document type' });

  const client = await pool.connect();
  try {
    if (!(await canAccessDocument(client, req.user, documentType, documentId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { rows } = await client.query(
      `SELECT id, document_type, document_id, signer_user_type, signer_role, signer_email,
              signer_name, signer_title, signature_hash, consent_text, signed_at
       FROM digital_signatures
       WHERE document_type = $1 AND document_id = $2
       ORDER BY signed_at ASC`,
      [documentType, documentId]
    );
    res.json(rows);
  } catch (e) {
    console.error('List signatures error:', e);
    res.status(500).json({ error: 'Failed to load digital signatures' });
  } finally {
    client.release();
  }
});

router.post('/', authenticate, async (req, res) => {
  const { document_type, document_id, signer_name, signer_title, consent } = req.body;
  if (!DOCUMENT_TYPES.has(document_type)) return res.status(400).json({ error: 'Invalid document type' });
  if (!document_id) return res.status(400).json({ error: 'document_id is required' });
  if (!signer_name || signer_name.trim().length < 2) return res.status(400).json({ error: 'Signer legal name is required' });
  if (consent !== true) return res.status(400).json({ error: 'Consent is required to sign electronically' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await canAccessDocument(client, req.user, document_type, document_id))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden' });
    }

    const signedAt = new Date().toISOString();
    const signaturePayload = [
      document_type,
      document_id,
      req.user.user_id,
      req.user.user_type,
      req.user.email || '',
      signer_name.trim(),
      signer_title || '',
      signedAt,
    ].join('|');
    const signatureHash = crypto.createHash('sha256').update(signaturePayload).digest('hex');

    const { rows: [signature] } = await client.query(
      `INSERT INTO digital_signatures
        (document_type, document_id, signer_user_id, signer_user_type, signer_role, signer_email,
         signer_name, signer_title, signature_hash, consent_text, ip_address, user_agent, signed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (document_type, document_id, signer_user_id, signer_user_type)
       DO UPDATE SET signer_name = EXCLUDED.signer_name,
                     signer_title = EXCLUDED.signer_title,
                     signature_hash = EXCLUDED.signature_hash,
                     consent_text = EXCLUDED.consent_text,
                     ip_address = EXCLUDED.ip_address,
                     user_agent = EXCLUDED.user_agent,
                     signed_at = EXCLUDED.signed_at
       RETURNING id, document_type, document_id, signer_user_type, signer_role, signer_email,
                 signer_name, signer_title, signature_hash, consent_text, signed_at`,
      [
        document_type,
        document_id,
        req.user.user_id,
        req.user.user_type,
        req.user.role || null,
        req.user.email || null,
        signer_name.trim(),
        signer_title || null,
        signatureHash,
        CONSENT_TEXT,
        req.ip || null,
        req.get('user-agent') || null,
        signedAt,
      ]
    );

    await client.query(
      `INSERT INTO audit_log (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        req.user.user_id,
        req.user.user_type,
        req.user.email || null,
        'digital_signature_applied',
        document_type,
        document_id,
        JSON.stringify({ signature_id: signature.id, signature_hash: signature.signature_hash }),
      ]
    );

    await client.query('COMMIT');
    res.status(201).json(signature);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Create signature error:', e);
    res.status(500).json({ error: 'Failed to apply digital signature' });
  } finally {
    client.release();
  }
});

module.exports = router;
