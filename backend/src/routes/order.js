const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const router = express.Router();

// Award bid: create order
router.post('/bids/:bidId/award', authenticate, requireRole('tenant_admin'), async (req, res) => {
  const { bidId } = req.params;
  const { supplier_id, total_amount, contract_file_path } = req.body;
  const { rows: [bid] } = await pool.query('SELECT tenant_id FROM bids WHERE id = $1', [bidId]);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  if (bid.tenant_id !== req.user.tenant_id) return res.status(403).json({ error: 'Forbidden' });
  const { rowCount: invitedSupplierCount } = await pool.query(
    'SELECT 1 FROM bid_suppliers WHERE bid_id = $1 AND supplier_id = $2',
    [bidId, supplier_id]
  );
  if (invitedSupplierCount === 0) return res.status(422).json({ error: 'Supplier was not invited to this bid' });
  // Mark bid as awarded
  await pool.query('UPDATE bids SET status = $1 WHERE id = $2', ['awarded', bidId]);
  const { rows: [order] } = await pool.query(
    `INSERT INTO orders (bid_id, awarded_supplier_id, total_amount, contract_file_path)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [bidId, supplier_id, total_amount, contract_file_path]
  );
  res.status(201).json(order);
});

// List orders for admin
router.get('/orders', authenticate, requireRole('tenant_admin'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.* FROM orders o
     JOIN bids b ON b.id = o.bid_id
     WHERE b.tenant_id = $1
     ORDER BY o.created_at DESC`,
    [req.user.tenant_id]
  );
  res.json(rows);
});

module.exports = router;
