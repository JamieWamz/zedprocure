const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const { requireUuid, requireEnum, cleanText } = require('../utils/requestValidation');
const { encryptDestination } = require('../utils/financialCrypto');
const { maskLast4 } = require('../services/escrowEngine');

const router = express.Router();

router.get('/payout-accounts', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Supplier access required' });
  const { rows } = await pool.query(
    `SELECT pa.id, pa.provider, pa.destination_last4, pa.bank_code, pa.account_name,
            pa.is_primary, pa.is_verified, pa.verified_at, pa.created_at
     FROM payout_accounts pa JOIN supplier_users su ON su.supplier_id=pa.supplier_id
     WHERE su.id=$1 ORDER BY pa.is_primary DESC, pa.created_at DESC`, [req.user.user_id]
  );
  res.json(rows);
});

router.post('/payout-accounts', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Supplier access required' });
  try {
    const provider = requireEnum(String(req.body.provider || '').toUpperCase(), ['MTN', 'AIRTEL', 'BANK'], 'provider');
    let destination = cleanText(req.body.destination, { required: true, maxLength: 64 });
    const bankCode = cleanText(req.body.bank_code, { maxLength: 40 });
    const accountName = cleanText(req.body.account_name, { maxLength: 150 });
    if (['MTN', 'AIRTEL'].includes(provider) && !/^260\d{9}$/.test(destination.replace(/[\s()+-]/g, ''))) {
      return res.status(400).json({ error: 'Mobile payout number must use 260XXXXXXXXX format' });
    }
    if (provider === 'BANK' && !/^[A-Za-z0-9-]{6,34}$/.test(destination.replace(/\s/g, ''))) {
      return res.status(400).json({ error: 'Bank account must contain 6 to 34 letters, digits, or hyphens' });
    }
    if (bankCode && !/^[A-Za-z0-9_-]{2,40}$/.test(bankCode)) {
      return res.status(400).json({ error: 'bank_code format is invalid' });
    }
    if (provider === 'BANK' && (!bankCode || !accountName)) {
      return res.status(400).json({ error: 'bank_code and account_name are required for bank payouts' });
    }
    destination = provider === 'BANK'
      ? destination.replace(/\s/g, '')
      : destination.replace(/[\s()+-]/g, '');
    const { rows: [supplier] } = await pool.query('SELECT supplier_id FROM supplier_users WHERE id=$1', [req.user.user_id]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (req.body.is_primary !== false) {
        await client.query('UPDATE payout_accounts SET is_primary=FALSE WHERE supplier_id=$1',
          [supplier.supplier_id]);
      }
      const { rows: [account] } = await client.query(
        `INSERT INTO payout_accounts
           (supplier_id, provider, encrypted_destination, destination_last4, bank_code, account_name, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, provider, destination_last4, bank_code, account_name, is_primary, is_verified, created_at`,
        [supplier.supplier_id, provider, encryptDestination(destination), maskLast4(destination),
          bankCode, accountName, req.body.is_primary !== false]
      );
      await client.query(
        `INSERT INTO notifications (user_id, user_type, type, title, message, link, metadata)
         SELECT id, 'platform_admin', 'payout_account_review', 'Payout account needs verification',
                'A supplier added a new ' || $1 || ' payout account. Verify ownership before escrow release.',
                '/admin/verification?section=payout-accounts', $2::jsonb
         FROM platform_admins WHERE role='business_admin' AND is_active=TRUE`,
        [provider, JSON.stringify({ payout_account_id: account.id, supplier_id: supplier.supplier_id })]
      );
      await client.query('COMMIT');
      res.status(201).json(account);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/admin/payout-accounts', authenticate, async (req, res) => {
  if (req.user.user_type !== 'platform_admin') return res.status(403).json({ error: 'Admin access required' });
  const { rows } = await pool.query(
    `SELECT pa.id, pa.provider, pa.destination_last4, pa.bank_code, pa.account_name,
            pa.is_primary, pa.is_verified, pa.verified_at, pa.created_at,
            s.id AS supplier_id, s.company_name
     FROM payout_accounts pa JOIN suppliers s ON s.id=pa.supplier_id
     ORDER BY pa.is_verified ASC, pa.created_at DESC`
  );
  res.json(rows);
});

router.post('/admin/payout-accounts/:id/verify', authenticate, async (req, res) => {
  if (req.user.user_type !== 'platform_admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const id = requireUuid(req.params.id, 'payout account id');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [account] } = await client.query(
        `UPDATE payout_accounts SET is_verified=TRUE, verified_at=now(), updated_at=now()
         WHERE id=$1 RETURNING id, supplier_id, provider, destination_last4, bank_code,
           account_name, is_primary, is_verified, verified_at`, [id]
      );
      if (!account) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Payout account not found' });
      }
      await client.query(
        `INSERT INTO audit_log (actor_id, actor_type, actor_email, action, target_type, target_id, details)
         VALUES ($1,$2,$3,'verify_payout_account','payout_account',$4,$5)`,
        [req.user.user_id, req.user.user_type, req.user.email, account.id,
          JSON.stringify({ supplier_id: account.supplier_id, provider: account.provider, destination_last4: account.destination_last4 })]
      );
      await client.query('COMMIT');
      delete account.supplier_id;
      res.json(account);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
