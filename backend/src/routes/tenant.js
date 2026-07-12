const express = require('express');
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

// Get bids - business_admin sees all, tenant_admin/business_admin with tenant_id sees their own
router.get('/tenant/bids', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'tenant_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    let rows;
    if (req.user.role === 'business_admin' && !req.user.tenant_id) {
      // Business admin without tenant context sees ALL bids across all tenants
      const result = await pool.query(
        'SELECT b.*, t.name AS tenant_name FROM bids b JOIN tenants t ON t.id = b.tenant_id ORDER BY b.created_at DESC'
      );
      rows = result.rows;
    } else {
      const tenantId = req.user.tenant_id;
      if (!tenantId) return res.status(400).json({ error: 'No tenant associated with your account.' });
      const result = await pool.query(
        'SELECT * FROM bids WHERE tenant_id = $1 ORDER BY created_at DESC',
        [tenantId]
      );
      rows = result.rows;
    }
    res.json(rows);
  } catch (e) {
    console.error('Error fetching bids:', e);
    res.status(500).json({ error: 'Failed to fetch bids' });
  }
});

// Get all tenants (for business_admin to select context)
router.get('/tenant/list', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'tenant_admin') {
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
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin' && req.user.role !== 'tenant_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { tenant_id, email, password, full_name, role } = req.body;
  if (!tenant_id || !email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'tenant_id, email, password, full_name, and role are required' });
  }
  if (!['tenant_admin', 'customer'].includes(role)) {
    return res.status(400).json({ error: 'Role must be tenant_admin or customer' });
  }

  // Business admin acting on behalf: ensure they can access this tenant
  if (req.user.role === 'tenant_admin' && req.user.tenant_id !== tenant_id) {
    return res.status(403).json({ error: 'You can only create users for your own tenant' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO tenant_users (tenant_id, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, email, full_name, role, is_active`,
      [tenant_id, email, hash, full_name, role]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'A user with this email already exists in this tenant.' });
    }
    console.error('Error creating tenant user:', e);
    res.status(500).json({ error: 'Failed to create user: ' + e.message });
  }
});

// Admin: List tenant users (with optional tenant_id filter)
router.get('/admin/tenant-users', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin' && req.user.role !== 'tenant_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    let query, params;
    if (req.user.role === 'tenant_admin') {
      // Tenant admin sees only their own tenant's users
      query = `SELECT tu.id, tu.tenant_id, tu.email, tu.full_name, tu.role, tu.is_active, tu.last_login,
                      t.name AS tenant_name
               FROM tenant_users tu JOIN tenants t ON t.id = tu.tenant_id
               WHERE tu.tenant_id = $1 ORDER BY tu.last_login DESC NULLS LAST`;
      params = [req.user.tenant_id];
    } else {
      // Business admin sees all
      query = `SELECT tu.id, tu.tenant_id, tu.email, tu.full_name, tu.role, tu.is_active, tu.last_login,
                      t.name AS tenant_name
               FROM tenant_users tu JOIN tenants t ON t.id = tu.tenant_id
               ORDER BY t.name ASC, tu.last_login DESC NULLS LAST`;
      params = [];
    }
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
  try {
    const { rows } = await pool.query(
      `UPDATE tenant_users SET is_active = NOT is_active WHERE id = $1 RETURNING id, email, full_name, role, is_active`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('Error toggling user status:', e);
    res.status(500).json({ error: 'Failed to toggle user status' });
  }
});

// Admin: Create a supplier
router.post('/admin/suppliers', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { company_name, registration_number, email, password, full_name } = req.body;
  if (!company_name || !email || !password || !full_name) {
    return res.status(400).json({ error: 'company_name, email, password, and full_name are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [supplier] } = await client.query(
      `INSERT INTO suppliers (company_name, registration_number, verification_status, is_active)
       VALUES ($1, $2, 'pending', false) RETURNING id, company_name, registration_number, verification_status, is_active`,
      [company_name, registration_number || null]
    );
    const hash = await bcrypt.hash(password, 12);
    const { rows: [user] } = await client.query(
      `INSERT INTO supplier_users (supplier_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4) RETURNING id, email, full_name`,
      [supplier.id, email, hash, full_name]
    );
    await client.query('COMMIT');
    res.status(201).json({ supplier, user });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      return res.status(409).json({ error: 'A supplier with this registration number or email already exists.' });
    }
    console.error('Error creating supplier:', e);
    res.status(500).json({ error: 'Failed to create supplier: ' + e.message });
  } finally {
    client.release();
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

// Audit log: record admin actions
router.post('/admin/audit-log', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin' && req.user.role !== 'tenant_admin') {
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