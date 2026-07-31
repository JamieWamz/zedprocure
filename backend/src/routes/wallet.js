/**
 * In-app Wallet Routes
 * Extracted from dashboard.js for domain isolation.
 * Provides wallet balance lookup and peer-to-peer transfers.
 */
const express = require('express');
const crypto = require('crypto');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const { debitWallet } = require('../services/walletService');
const { calculateWithdrawal, MonetizationError } = require('../services/monetizationService');
const { cleanText, requireEnum } = require('../utils/requestValidation');
const router = express.Router();

async function withdrawalPricing(amount) {
  const { rows: [settings] } = await pool.query(
    'SELECT withdrawal_fee_percent, withdrawal_fee_fixed FROM platform_monetization_settings WHERE singleton_id = TRUE'
  );
  return calculateWithdrawal({
    grossAmount: amount,
    feePercent: settings.withdrawal_fee_percent,
    fixedFee: settings.withdrawal_fee_fixed,
  });
}

// ─── Get wallet balance and recent transactions ──────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows: [wallet] } = await pool.query(
      `SELECT id, balance FROM wallets WHERE user_id=$1 AND user_type=$2`,
      [req.user.user_id, req.user.user_type]
    );
    if (!wallet) {
      return res.json({ balance: '0.00', transactions: [] });
    }
    const { rows: txns } = await pool.query(
      `SELECT * FROM wallet_transactions WHERE wallet_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [wallet.id]
    );
    res.json({ balance: parseFloat(wallet.balance).toFixed(2), transactions: txns });
  } catch (e) {
    console.error('Wallet error:', e);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// ─── In-app Transfer ─────────────────────────────────────────────────────────
router.post('/transfer', authenticate, async (req, res) => {
  const { to_email, amount, description } = req.body;
  const requestedAmount = Number(amount);
  if (!to_email || !Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > 1_000_000_000) {
    return res.status(400).json({ error: 'Recipient email and positive amount required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock sender wallet
    const { rows: [senderWallet] } = await client.query(
      `SELECT * FROM wallets WHERE user_id=$1 AND user_type=$2 FOR UPDATE`,
      [req.user.user_id, req.user.user_type]
    );
    if (!senderWallet || parseFloat(senderWallet.balance) < parseFloat(amount)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Find recipient wallet
    const { rows: [recipient] } = await client.query(
      `SELECT id, user_id, user_type, balance FROM wallets WHERE user_id IN (
        SELECT id FROM tenant_users WHERE email=$1 AND is_active=true
        UNION ALL SELECT id FROM supplier_users WHERE email=$1
        UNION ALL SELECT id FROM platform_admins WHERE email=$1 AND is_active=true
      ) LIMIT 1 FOR UPDATE`,
      [to_email]
    );
    if (!recipient) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Recipient not found' });
    }
    if (recipient.id === senderWallet.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot transfer funds to the same wallet' });
    }

    const txId = crypto.randomUUID();
    const amt = requestedAmount;

    // Debit sender
    await client.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, balance_before, balance_after, description)
       VALUES ($1, $2, 'transfer_out', $3, $4, $5, $6)`,
      [txId, senderWallet.id, amt, senderWallet.balance, parseFloat(senderWallet.balance) - amt, description || `Transfer to ${to_email}`]
    );
    await client.query(`UPDATE wallets SET balance=$1, updated_at=NOW() WHERE id=$2`,
      [parseFloat(senderWallet.balance) - amt, senderWallet.id]);

    // Credit recipient
    await client.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, balance_before, balance_after, description)
       VALUES ($1, $2, 'transfer_in', $3, $4, $5, $6)`,
      [crypto.randomUUID(), recipient.id, amt, parseFloat(recipient.balance), parseFloat(recipient.balance) + amt, `Transfer from ${req.user.email}`]
    );
    await client.query(`UPDATE wallets SET balance=$1, updated_at=NOW() WHERE id=$2`,
      [parseFloat(recipient.balance) + amt, recipient.id]);

    await client.query('COMMIT');
    const { rows: [updated] } = await pool.query('SELECT balance FROM wallets WHERE id=$1', [senderWallet.id]);
    res.json({ message: 'Transfer completed', balance: parseFloat(updated.balance).toFixed(2) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Transfer error:', e);
    res.status(500).json({ error: 'Transfer failed' });
  } finally {
    client.release();
  }
});

router.post('/withdrawals/preview', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    res.json(await withdrawalPricing(req.body.amount));
  } catch (e) {
    const status = e instanceof MonetizationError ? 422 : 500;
    res.status(status).json({ error: status === 422 ? e.message : 'Failed to calculate payout' });
  }
});

// Supplier payout request. Fees are calculated from server settings and the
// gross debit is locked atomically so simultaneous withdrawals cannot overspend.
router.post('/withdrawals', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') {
    return res.status(403).json({ error: 'Only suppliers can request payouts' });
  }
  let payoutMethod;
  let destination;
  try {
    payoutMethod = requireEnum(req.body.payout_method, ['mobile_money', 'bank_transfer'], 'payout_method');
    destination = cleanText(req.body.payout_destination, { required: true, maxLength: 255 });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [settings] } = await client.query(
      'SELECT withdrawal_fee_percent, withdrawal_fee_fixed FROM platform_monetization_settings WHERE singleton_id = TRUE'
    );
    const pricing = calculateWithdrawal({
      grossAmount: req.body.amount,
      feePercent: settings.withdrawal_fee_percent,
      fixedFee: settings.withdrawal_fee_fixed,
    });
    const { rows: [wallet] } = await client.query(
      `SELECT id FROM wallets WHERE user_id = $1 AND user_type = 'supplier_user' FOR UPDATE`,
      [req.user.user_id]
    );
    if (!wallet) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Wallet not found' });
    }
    const requestId = crypto.randomUUID();
    await debitWallet(wallet.id, pricing.grossAmount, 'Supplier payout request', client, {
      reference: `withdrawal:${requestId}`,
    });
    await client.query(
      `INSERT INTO withdrawal_requests
         (id, wallet_id, requested_by, gross_amount, processing_fee, net_payout,
          payout_method, payout_destination)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [requestId, wallet.id, req.user.user_id, pricing.grossAmount, pricing.processingFee,
       pricing.netPayout, payoutMethod, destination]
    );
    await client.query(
      `INSERT INTO payment_transactions
         (from_user_id, amount, payment_method, transaction_ref, type, status, gateway_response)
       VALUES ($1,$2,$3,$4,'payout','initiated',$5)`,
      [req.user.user_id, pricing.netPayout, payoutMethod, `PAYOUT-${requestId}`,
       JSON.stringify({ withdrawal_request_id: requestId, processing_fee: pricing.processingFee })]
    );
    await client.query('COMMIT');
    res.status(201).json({ id: requestId, status: 'pending', ...pricing });
  } catch (e) {
    await client.query('ROLLBACK');
    const status = e instanceof MonetizationError || e.message === 'Insufficient wallet balance' ? 422 : 500;
    res.status(status).json({ error: e.message || 'Payout request failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
