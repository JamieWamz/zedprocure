const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

// Award bid (create order)
router.post('/bids/:bidId/award', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'tenant_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { bidId } = req.params;
  const { supplier_id, total_amount, contract_file_path } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify bid belongs to tenant
    const { rows: [bid] } = await client.query(
      'SELECT tenant_id, status FROM bids WHERE id = $1 FOR UPDATE',
      [bidId]
    );
    if (!bid) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bid not found' });
    }
    if (bid.status !== 'open' && bid.status !== 'evaluation') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Bid is not in awardable state' });
    }

    // Verify tenant access
    if (req.user.tenant_id && bid.tenant_id !== req.user.tenant_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden: bid belongs to another tenant' });
    }

    // Update bid status and create order in a single transaction
    await client.query('UPDATE bids SET status = $1 WHERE id = $2', ['awarded', bidId]);
    const { rows: [order] } = await client.query(
      `INSERT INTO orders (bid_id, awarded_supplier_id, total_amount, contract_file_path)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [bidId, supplier_id, total_amount, contract_file_path]
    );

    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error awarding bid:', e);
    res.status(500).json({ error: 'Failed to award bid: ' + e.message });
  } finally {
    client.release();
  }
});

// List all orders (with tenant isolation)
router.get('/orders', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'tenant_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    let query, params;
    if (req.user.tenant_id) {
      // Tenant-scoped query
      query = `SELECT o.* FROM orders o
               JOIN bids b ON b.id = o.bid_id
               WHERE b.tenant_id = $1
               ORDER BY o.created_at DESC`;
      params = [req.user.tenant_id];
    } else {
      // Business admin sees all
      query = 'SELECT * FROM orders ORDER BY created_at DESC';
      params = [];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    console.error('Error fetching orders:', e);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

module.exports = router;