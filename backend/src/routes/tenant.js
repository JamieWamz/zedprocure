const express = require('express');
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { authenticate } = require('../middleware/authMiddleware');
const { validatePassword } = require('../utils/passwordValidation');
const { cleanText, requireUuid } = require('../utils/requestValidation');
const {
  assertIdentityEmailAvailable,
  requireValidIdentityEmail,
} = require('../services/identityEmailGuard');
const router = express.Router();

const { getOrganizationBids } = require('../services/bidService');

// Get bids - business_admin sees all; customers see their own organization's bids.
router.get('/tenant/bids', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const rows = await getOrganizationBids(req.user);
    res.json(rows);
  } catch (e) {
    console.error('Error fetching bids:', e);
    // Use a 400 for context errors, 500 for others
    const statusCode = e.message.includes('context') ? 400 : 500;
    res.status(statusCode).json({ error: e.message || 'Failed to fetch bids' });
  }
});

// Get all tenants (for business_admin to select context)
router.get('/tenant/list', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, name, registration_number, is_active, created_at FROM tenants ORDER BY name'
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching tenants:', e);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

// Admin: Create a new tenant (organization)
router.post('/admin/tenants', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { name, registration_number } = req.body;
  if (!name) return res.status(400).json({ error: 'Tenant name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO tenants (name, registration_number) VALUES ($1, $2) RETURNING id, name, registration_number, is_active, created_at`,
      [name, registration_number || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('Error creating tenant:', e);
    res.status(500).json({ error: 'Failed to create tenant: ' + e.message });
  }
});

// Admin: List all tenants (full detail)
router.get('/admin/tenants', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT t.*, 
        (SELECT COUNT(*) FROM tenant_users WHERE tenant_id = t.id AND is_active = true) AS active_users,
        (SELECT COUNT(*) FROM bids WHERE tenant_id = t.id) AS total_bids
       FROM tenants t ORDER BY t.name`
    );
    res.json(rows);
  } catch (e) {
    console.error('Error listing tenants:', e);
    res.status(500).json({ error: 'Failed to list tenants' });
  }
});

// Admin: Create a tenant user (client account)
router.post('/admin/tenant-users', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { password } = req.body;
  if (!req.body.tenant_id || !req.body.email || !password || !req.body.full_name) {
    return res.status(400).json({ error: 'tenant_id, email, password, and full_name are required' });
  }

  let tenantId;
  let email;
  let fullName;
  try {
    tenantId = requireUuid(req.body.tenant_id, 'tenant_id');
    email = requireValidIdentityEmail(req.body.email);
    fullName = cleanText(req.body.full_name, { required: true, maxLength: 150 });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    await assertIdentityEmailAvailable(client, email);
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await client.query(
      `INSERT INTO tenant_users (tenant_id, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, email, full_name, role, is_active`,
      [tenantId, email, hash, fullName, 'customer']
    );
    await client.query('COMMIT');
    transactionStarted = false;
    res.status(201).json(rows[0]);
  } catch (e) {
    if (transactionStarted && client) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be unavailable */ }
    }
    if (e.statusCode === 409 || e.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error('Error creating tenant user:', e);
    res.status(500).json({ error: 'Failed to create user' });
  } finally {
    client?.release();
  }
});

// Admin: List tenant users (with optional tenant_id filter)
router.get('/admin/tenant-users', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    let query, params;
    query = `SELECT tu.id, tu.tenant_id, tu.email, tu.full_name, tu.role, tu.is_active, tu.last_login,
                    t.name AS tenant_name
             FROM tenant_users tu JOIN tenants t ON t.id = tu.tenant_id
             ORDER BY t.name ASC, tu.last_login DESC NULLS LAST`;
    params = [];
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    console.error('Error listing tenant users:', e);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// Admin: Toggle user active status
router.put('/admin/tenant-users/:id/toggle-active', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let userId;
  try {
    userId = requireUuid(req.params.id, 'id');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    const { rows: [existing] } = await client.query(
      `SELECT id, email, full_name, role, is_active
       FROM tenant_users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );
    if (!existing) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'User not found' });
    }

    const nextActive = !existing.is_active;
    if (nextActive) {
      await assertIdentityEmailAvailable(client, existing.email, {
        userType: 'tenant_user',
        id: userId,
      });
    }

    const { rows: [updatedUser] } = await client.query(
      `UPDATE tenant_users
       SET is_active = $1
       WHERE id = $2
       RETURNING id, email, full_name, role, is_active`,
      [nextActive, userId]
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, 'tenant_user', $5, $6)`,
      [
        req.user.id || req.user.user_id,
        req.user.user_type || 'platform_admin',
        req.user.email || null,
        nextActive ? 'tenant_user_activated' : 'tenant_user_deactivated',
        userId,
        JSON.stringify({ changed_fields: ['is_active'], status_changed: true }),
      ]
    );
    await client.query('COMMIT');
    transactionStarted = false;
    return res.json(updatedUser);
  } catch (e) {
    if (transactionStarted && client) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be unavailable */ }
    }
    if (e.statusCode === 409 || e.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error('Error toggling user status:', e);
    return res.status(500).json({ error: 'Failed to toggle user status' });
  } finally {
    client?.release();
  }
});

// Admin: Create a supplier
router.post('/admin/suppliers', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { registration_number, password } = req.body;
  if (!req.body.company_name || !req.body.email || !password || !req.body.full_name) {
    return res.status(400).json({ error: 'company_name, email, password, and full_name are required' });
  }
  let companyName;
  let email;
  let fullName;
  try {
    companyName = cleanText(req.body.company_name, { required: true, maxLength: 255 });
    email = requireValidIdentityEmail(req.body.email);
    fullName = cleanText(req.body.full_name, { required: true, maxLength: 150 });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    await assertIdentityEmailAvailable(client, email);
    const { rows: [supplier] } = await client.query(
      `INSERT INTO suppliers (company_name, registration_number, verification_status, is_active)
       VALUES ($1, $2, 'pending', false) RETURNING id, company_name, registration_number, verification_status, is_active`,
      [companyName, registration_number || null]
    );
    const hash = await bcrypt.hash(password, 12);
    const { rows: [user] } = await client.query(
      `INSERT INTO supplier_users (supplier_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4) RETURNING id, email, full_name`,
      [supplier.id, email, hash, fullName]
    );
    await client.query('COMMIT');
    transactionStarted = false;
    res.status(201).json({ supplier, user });
  } catch (e) {
    if (transactionStarted && client) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be unavailable */ }
    }
    if (e.statusCode === 409 || e.code === '23505') {
      return res.status(409).json({ error: 'A supplier with this registration number or email already exists.' });
    }
    console.error('Error creating supplier:', e);
    res.status(500).json({ error: 'Failed to create supplier' });
  } finally {
    client?.release();
  }
});

// Admin: List all suppliers
router.get('/admin/suppliers', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT s.*, 
        (SELECT COUNT(*) FROM supplier_users WHERE supplier_id = s.id) AS user_count
       FROM suppliers s ORDER BY s.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error('Error listing suppliers:', e);
    res.status(500).json({ error: 'Failed to list suppliers' });
  }
});

// Audit log: record admin actions from the frontend, if needed.
// Most audit logging is now handled internally by dedicated services, but this
// endpoint is retained as a generic utility for client-side logging.
router.post('/admin/audit-log', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { action, target_type, target_id, details } = req.body;
  if (!action) return res.status(400).json({ error: 'Action is required' });
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.user_id, req.user.user_type, req.user.email, action, target_type, target_id, details || null]
    );
    res.status(201).json({ success: true });
  } catch (e) {
    console.error('Error recording audit log:', e);
    res.status(500).json({ error: 'Failed to record audit log' });
  }
});

// Get audit logs
router.get('/admin/audit-logs', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100'
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching audit logs:', e);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
