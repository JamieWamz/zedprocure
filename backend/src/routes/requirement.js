const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { notifyBusinessAdmins } = require('../services/notificationService');
const router = express.Router();

// Customer creates or updates requirement for a bid (upsert)
router.post('/bids/:bidId/requirements', authenticate, requireRole('customer'), async (req, res) => {
  const { bidId } = req.params;
  const { budget_amount, expected_delivery_time, payment_method, certification_standards, file_path } = req.body;

  try {
    // Verify user's tenant matches the bid's tenant and fetch bid title
    const authCheck = await pool.query(
      `SELECT b.id, b.title FROM bids b
       JOIN tenant_users tu ON b.tenant_id = tu.tenant_id
       WHERE b.id = $1 AND tu.id = $2`,
      [bidId, req.user.user_id]
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this bid.' });
    }

    const bidTitle = authCheck.rows[0].title;

    const { rows } = await pool.query(
      `INSERT INTO bid_requirements (bid_id, customer_user_id, budget_amount, expected_delivery_time, payment_method, certification_standards, specifications_file_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (bid_id, customer_user_id) DO UPDATE SET
         budget_amount = EXCLUDED.budget_amount,
         expected_delivery_time = EXCLUDED.expected_delivery_time,
         payment_method = EXCLUDED.payment_method,
         certification_standards = EXCLUDED.certification_standards,
         specifications_file_path = COALESCE(EXCLUDED.specifications_file_path, bid_requirements.specifications_file_path)
       RETURNING *`,
      [bidId, req.user.user_id, budget_amount, expected_delivery_time, payment_method, certification_standards, file_path]
    );

    // Notify Business Admin immediately
    notifyBusinessAdmins({
      type: 'customer_requirement',
      title: `Customer Requirement Submitted: ${bidTitle}`,
      message: `Customer ${req.user.full_name || req.user.email} submitted procurement requirements for bid "${bidTitle}". Budget: ZMW ${budget_amount || 'N/A'}. Payment method: ${payment_method || 'N/A'}.`,
      link: `/bids/${bidId}`,
      metadata: { bid_id: bidId, customer_user_id: req.user.user_id },
    }).catch(err => console.error('Failed to send admin notification:', err));

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('Error creating bid requirement:', e);
    res.status(500).json({ error: 'Failed to create requirement: ' + e.message });
  }
});

module.exports = router;
