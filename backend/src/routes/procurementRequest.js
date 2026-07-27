const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { notifyBusinessAdmins } = require('../services/notificationService');
const router = express.Router();

// Customer creates a direct procurement request (when no bid exists yet)
router.post('/procurement-requests', authenticate, requireRole('customer'), async (req, res) => {
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
router.get('/procurement-requests', authenticate, requireRole('customer'), async (req, res) => {
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

// Admin gets all procurement requests
router.get('/admin/procurement-requests', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pr.*, tu.full_name AS customer_name, tu.email AS customer_email, t.name AS tenant_name
       FROM procurement_requests pr
       JOIN tenant_users tu ON tu.id = pr.customer_user_id
       JOIN tenants t ON t.id = pr.tenant_id
       ORDER BY pr.created_at DESC LIMIT 500`
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching all procurement requests:', e);
    res.status(500).json({ error: 'Failed to fetch procurement requests' });
  }
});

// Admin updates a procurement request status
router.put('/admin/procurement-requests/:id/status', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected', 'fulfilled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE procurement_requests SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Procurement request not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('Error updating procurement request status:', e);
    res.status(500).json({ error: 'Failed to update procurement request status' });
  }
});

module.exports = router;
