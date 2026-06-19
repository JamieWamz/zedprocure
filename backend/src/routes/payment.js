const express = require('express');
const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/authMiddleware');
const { recordBiddingFee } = require('../services/ledgerService');
const router = express.Router();

// Initiate bidding fee payment (returns a payment reference)
router.post('/payments/bidding-fee', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  const { bid_id, payment_method } = req.body;
  const { rows: [bid] } = await pool.query(
    `SELECT b.bidding_fee_amount
     FROM bids b
     JOIN bid_suppliers bs ON bs.bid_id = b.id
     JOIN supplier_users su ON su.supplier_id = bs.supplier_id
     WHERE b.id = $1 AND su.id = $2`,
    [bid_id, req.user.user_id]
  );
  if (!bid) return res.status(404).json({ error: 'Bid invitation not found' });
  const ref = `BID-${Date.now()}-${uuidv4().slice(0,8)}`;
  await pool.query(
    `INSERT INTO payment_transactions (from_user_id, amount, payment_method, transaction_ref, type, status)
     VALUES ($1,$2,$3,$4,'bidding_fee','initiated')`,
    [req.user.user_id, bid.bidding_fee_amount, payment_method, ref]
  );
  res.status(201).json({ transaction_ref: ref, status: 'initiated' });
});

// Confirm payment (manual or callback) – idempotent via unique ref
router.post('/payments/confirm', authenticate, async (req, res) => {
  const { transaction_ref } = req.body;
  const { rows: [tx] } = await pool.query(
    `SELECT * FROM payment_transactions WHERE transaction_ref = $1 FOR UPDATE`,
    [transaction_ref]
  );
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  if (tx.status === 'completed') return res.json({ message: 'Already confirmed', tx });

  await pool.query('UPDATE payment_transactions SET status = $1 WHERE transaction_ref = $2', ['completed', transaction_ref]);

  // If bidding fee, record ledger entry
  if (tx.type === 'bidding_fee') {
    // Fetch bid_id from the request? We'll need to link. For MVP, pass bid_id in confirm body.
    const { bid_id } = req.body;
    if (bid_id) {
      await recordBiddingFee(bid_id, tx.from_user_id, tx.amount, transaction_ref);
    }
  }
  res.json({ message: 'Payment confirmed', transaction_ref });
});

module.exports = router;
