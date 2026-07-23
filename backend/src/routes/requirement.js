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

// Customer creates a direct procurement request (when no bid exists yet)
router.post('/customer/procurement-requests', authenticate, requireRole('customer'), async (req, res) => {
  const { title, description, estimated_budget, payment_method, required_delivery_date } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required for procurement request' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO procurement_requests (tenant_id, customer_user_id, title, description, estimated_budget, payment_method, required_delivery_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [req.user.tenant_id, req.user.user_id, title, description, estimated_budget || null, payment_method || null, required_delivery_date || null]
    );

    const request = rows[0];

    // Notify Business Admin immediately
    notifyBusinessAdmins({
      type: 'customer_request',
      title: `New Customer Procurement Request: ${title}`,
      message: `Customer ${req.user.full_name || req.user.email} created a procurement request "${title}". Est. Budget: ZMW ${estimated_budget || 'N/A'}.`,
      link: '/admin',
      metadata: { request_id: request.id, tenant_id: req.user.tenant_id },
    }).catch(err => console.error('Failed to send admin notification:', err));

    res.status(201).json(request);
  } catch (e) {
    console.error('Error creating procurement request:', e);
    res.status(500).json({ error: 'Failed to create procurement request: ' + e.message });
  }
});

// Customer gets all their procurement requests
router.get('/customer/procurement-requests', authenticate, requireRole('customer'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pr.*, tu.full_name AS customer_name, tu.email AS customer_email
       FROM procurement_requests pr
       JOIN tenant_users tu ON tu.id = pr.customer_user_id
       WHERE pr.tenant_id = $1
       ORDER BY pr.created_at DESC`,
      [req.user.tenant_id]
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching customer procurement requests:', e);
    res.status(500).json({ error: 'Failed to fetch procurement requests' });
  }
});

// Admin gets all customer procurement requests across tenants
router.get('/admin/procurement-requests', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT pr.*, t.name AS tenant_name, tu.full_name AS customer_name, tu.email AS customer_email
       FROM procurement_requests pr
       JOIN tenants t ON t.id = pr.tenant_id
       JOIN tenant_users tu ON tu.id = pr.customer_user_id
       ORDER BY pr.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching admin procurement requests:', e);
    res.status(500).json({ error: 'Failed to fetch procurement requests' });
  }
});

// Admin updates procurement request status (e.g. approve, convert to bid, reject)
router.put('/admin/procurement-requests/:id/status', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { status, admin_notes } = req.body;
  if (!['pending', 'approved', 'converted_to_bid', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const { rows: [updated] } = await pool.query(
      `UPDATE procurement_requests
       SET status = $1, admin_notes = COALESCE($2, admin_notes), updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [status, admin_notes || null, req.params.id]
    );
    if (!updated) return res.status(404).json({ error: 'Request not found' });
    res.json(updated);
  } catch (e) {
    console.error('Error updating procurement request status:', e);
    res.status(500).json({ error: 'Failed to update request status' });
  }
});

module.exports = router;
