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
  if (!order_id || !payment_method || !transaction_ref) {
    return res.status(400).json({ error: 'order_id, payment_method and transaction_ref are required' });
  }
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'Invalid funding amount' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [order] } = await client.query(
      `SELECT b.tenant_id FROM orders o JOIN bids b ON b.id = o.bid_id WHERE o.id = $1 FOR UPDATE OF o`,
      [order_id]
    );
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.tenant_id !== req.user.tenant_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Lock the escrow row so concurrent requests cannot both pass the status check.
    const { rows: [existingEscrow] } = await client.query(
      `SELECT status FROM escrow_accounts WHERE order_id = $1 FOR UPDATE`,
      [order_id]
    );
    if (existingEscrow) {
      if (existingEscrow.status === 'funded' || existingEscrow.status === 'released') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Escrow is already funded' });
      }
      if (existingEscrow.status === 'refunded') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Escrow has been refunded' });
      }
    }

    await client.query(
      `INSERT INTO escrow_accounts (order_id, customer_user_id, amount, status)
       VALUES ($1,$2,$3,'funded') ON CONFLICT (order_id) DO UPDATE SET status = 'funded', funded_at = now(), amount = EXCLUDED.amount`,
      [order_id, req.user.user_id, amountNum]
    );
    await client.query(
      `INSERT INTO payment_transactions (from_user_id, amount, payment_method, transaction_ref, type, status)
       VALUES ($1,$2,$3,$4,'escrow_funding','completed')`,
      [req.user.user_id, amountNum, payment_method, transaction_ref]
    );
    await recordEscrowFunding(order_id, req.user.user_id, amountNum, client);

    await client.query('COMMIT');
    res.json({ message: 'Escrow funded' });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Transaction reference already exists' });
    }
    console.error('Error funding escrow:', e);
    res.status(500).json({ error: 'Failed to fund escrow' });
  } finally {
    client.release();
  }
});

// Business Admin releases escrow to supplier after fulfillment checks.
router.post('/escrow/release', authenticate, requireRole('business_admin'), async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [escrow] } = await client.query(
      `SELECT ea.* FROM escrow_accounts ea
       JOIN orders o ON o.id = ea.order_id
       JOIN bids b ON b.id = o.bid_id
       WHERE ea.order_id = $1 FOR UPDATE OF ea`,
      [order_id]
    );
    if (!escrow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Escrow not found' });
    }
    if (escrow.status !== 'funded') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Escrow not funded' });
    }

    await client.query('UPDATE escrow_accounts SET status = $1, released_at = now() WHERE order_id = $2', ['released', order_id]);
    await recordEscrowRelease(order_id, req.user.user_id, escrow.amount, client);

    await client.query('COMMIT');
    res.json({ message: 'Escrow released to supplier' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error releasing escrow:', e);
    res.status(500).json({ error: 'Failed to release escrow' });
  } finally {
    client.release();
  }
});

module.exports = router;
