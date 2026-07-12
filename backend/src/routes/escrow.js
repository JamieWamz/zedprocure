const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { recordEscrowFunding, recordEscrowRelease } = require('../services/ledgerService');
const router = express.Router();

// Customer funds escrow
router.post('/escrow/fund', authenticate, async (req, res) => {
  if (req.user.user_type !== 'tenant_user' || req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Only customers can fund escrow' });
  }
  const { order_id, amount, payment_method, transaction_ref } = req.body;
  const { rows: [order] } = await pool.query(
    `SELECT b.tenant_id FROM orders o JOIN bids b ON b.id = o.bid_id WHERE o.id = $1`,
    [order_id]
  );
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.tenant_id !== req.user.tenant_id) return res.status(403).json({ error: 'Forbidden' });

  // Check if escrow already exists and its status
  const { rows: [existingEscrow] } = await pool.query(
    `SELECT status FROM escrow_accounts WHERE order_id = $1`,
    [order_id]
  );
  if (existingEscrow) {
    if (existingEscrow.status === 'funded' || existingEscrow.status === 'released') {
      return res.status(400).json({ error: 'Escrow is already funded' });
    }
    if (existingEscrow.status === 'refunded') {
      return res.status(400).json({ error: 'Escrow has been refunded' });
    }
  }

  // Create escrow account if not exists, or update if pending_funding
  await pool.query(
    `INSERT INTO escrow_accounts (order_id, customer_user_id, amount, status)
     VALUES ($1,$2,$3,'funded') ON CONFLICT (order_id) DO UPDATE SET status = 'funded', funded_at = now()`,
    [order_id, req.user.user_id, amount]
  );
  await pool.query(
    `INSERT INTO payment_transactions (from_user_id, amount, payment_method, transaction_ref, type, status)
     VALUES ($1,$2,$3,$4,'escrow_funding','completed')`,
    [req.user.user_id, amount, payment_method, transaction_ref]
  );
  await recordEscrowFunding(order_id, req.user.user_id, amount);
  res.json({ message: 'Escrow funded' });
});

// Admin releases escrow to supplier
router.post('/escrow/release', authenticate, requireRole('tenant_admin'), async (req, res) => {
  const { order_id } = req.body;
  const { rows: [escrow] } = await pool.query(
    `SELECT ea.* FROM escrow_accounts ea
     JOIN orders o ON o.id = ea.order_id
     JOIN bids b ON b.id = o.bid_id
     WHERE ea.order_id = $1 AND b.tenant_id = $2`,
    [order_id, req.user.tenant_id]
  );
  if (!escrow || escrow.status !== 'funded') return res.status(400).json({ error: 'Escrow not funded' });
  await pool.query('UPDATE escrow_accounts SET status = $1, released_at = now() WHERE order_id = $2', ['released', order_id]);
  await recordEscrowRelease(order_id, req.user.user_id, escrow.amount);
  res.json({ message: 'Escrow released to supplier' });
});

module.exports = router;
