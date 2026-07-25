/**
 * In-app Wallet Routes
 * Extracted from dashboard.js for domain isolation.
 * Provides wallet balance lookup and peer-to-peer transfers.
 */
const express = require('express');
const crypto = require('crypto');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

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
  if (!to_email || !amount || amount <= 0) {
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
      ) LIMIT 1`,
      [to_email]
    );
    if (!recipient) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Recipient not found' });
    }

    const txId = crypto.randomUUID();
    const amt = parseFloat(amount);

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

module.exports = router;