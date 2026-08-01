const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { notifyBusinessAdmins } = require('../services/notificationService');
const { cleanText, requireUuid } = require('../utils/requestValidation');
const router = express.Router();

const PAYMENT_METHODS = ['mtn', 'airtel', 'zamtel', 'bank_transfer', 'escrow'];
const UNITS = ['each', 'kg', 'g', 'ton', 'meters', 'cm', 'liters', 'ml', 'sqm', 'sqft', 'hours', 'days', 'months', 'lump_sum', 'boxes', 'pairs', 'sets'];

function normalizeRequirements(value, fallbackDescription = '') {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const legacyQuantity = String(fallbackDescription).match(/Quantity:\s*([\d.]+)\s+([a-z_]+)/i);
  const quantity = Number(input.quantity ?? legacyQuantity?.[1] ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
    throw new Error('Quantity must be greater than zero and within the permitted range');
  }
  const unit = input.unit_of_measure || legacyQuantity?.[2]?.toLowerCase() || 'each';
  if (!UNITS.includes(unit)) throw new Error('Select a valid unit of measure');

  const legacySpecification = String(fallbackDescription)
    .replace(/^### Specifications\s*/i, '')
    .split(/\n### /)[0]
    .trim();
  const legacyWarranty = String(fallbackDescription).match(/### Warranty & Support Requirements\s*([\s\S]*)$/i)?.[1]?.trim();

  return {
    specification: cleanText(input.specification || legacySpecification || fallbackDescription, { required: true, maxLength: 10000 }),
    quantity,
    unit_of_measure: unit,
    warranty: cleanText(input.warranty || legacyWarranty, { maxLength: 2000 }),
    business_category: cleanText(input.business_category, { maxLength: 100 }),
  };
}

// Customer creates a direct procurement request (when no bid exists yet)
router.post('/procurement-requests', authenticate, requireRole('customer'), async (req, res) => {
  const { estimated_budget, payment_method, required_delivery_date } = req.body;
  let title;
  let description;
  let requirements;
  let budget = null;
  let deliveryDate = null;
  try {
    title = cleanText(req.body.title, { required: true, maxLength: 255 });
    description = cleanText(req.body.description, { maxLength: 15000 });
    requirements = normalizeRequirements(req.body.requirements, description);

    if (estimated_budget !== undefined && estimated_budget !== null && estimated_budget !== '') {
      budget = Number(estimated_budget);
      if (!Number.isFinite(budget) || budget <= 0 || budget > 1_000_000_000) {
        throw new Error('Budget estimate must be a positive amount within the permitted range');
      }
    }
    if (!PAYMENT_METHODS.includes(payment_method)) throw new Error('Select a supported payment method');
    if (required_delivery_date) {
      deliveryDate = new Date(required_delivery_date);
      if (Number.isNaN(deliveryDate.getTime())) throw new Error('Needed-by date is invalid');
      if (deliveryDate.getTime() <= Date.now()) throw new Error('Needed-by date must be in the future');
    }
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO procurement_requests
         (tenant_id, customer_user_id, title, description, requirements, estimated_budget, payment_method, required_delivery_date, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'pending')
       RETURNING *`,
      [req.user.tenant_id, req.user.user_id, title, description, JSON.stringify(requirements), budget, payment_method, deliveryDate]
    );

    const request = rows[0];

    // Notify Business Admin immediately
    notifyBusinessAdmins({
      type: 'customer_request',
      title: `New Customer Procurement Request: ${title}`,
      message: `Customer ${req.user.full_name || req.user.email} created a procurement request "${title}". Est. Budget: ZMW ${estimated_budget || 'N/A'}.`,
      link: `/admin?section=procurement-requests&focus=${request.id}`,
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
  try {
    requireUuid(id, 'request id');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (!['pending', 'approved', 'converted_to_bid', 'rejected'].includes(status)) {
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
