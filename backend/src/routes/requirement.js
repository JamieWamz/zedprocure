const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const router = express.Router();

// Customer creates requirement for a bid
router.post('/bids/:bidId/requirements', authenticate, requireRole('customer'), async (req, res) => {
  const { bidId } = req.params;
  const { budget_amount, expected_delivery_time, payment_method, certification_standards, file_path } = req.body;
  // Ensure the customer belongs to the same tenant as the bid
  const { rows: [bid] } = await pool.query('SELECT tenant_id FROM bids WHERE id=$1', [bidId]);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  const { rows: [user] } = await pool.query('SELECT tenant_id FROM tenant_users WHERE id=$1', [req.user.user_id]);
  if (user.tenant_id !== bid.tenant_id) return res.status(403).json({ error: 'Forbidden' });

  const { rows } = await pool.query(
    `INSERT INTO bid_requirements (bid_id, customer_user_id, budget_amount, expected_delivery_time, payment_method, certification_standards, specifications_file_path)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [bidId, req.user.user_id, budget_amount, expected_delivery_time, payment_method, certification_standards, file_path]
  );
  res.status(201).json(rows[0]);
});

module.exports = router;
