const express = require('express');
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { validatePassword } = require('../utils/validation');
const { sendInvitation } = require('../services/emailService');
const crypto = require('crypto');
const router = express.Router();
const IMMUTABLE_EMAIL = 'wamuyuwamundia@gmail.com';
const ADMIN_ROLE_LABELS = {
  system_admin: 'System Admin',
  business_admin: 'Business Admin',
};

router.get('/health', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', timestamp: new Date().toISOString(), db: 'connected' });
  } catch (e) {
    res.status(500).json({ status: 'degraded', error: e.message });
  }
});

router.post('/admins', authenticate, requireRole('system_admin'), async (req, res) => {
  const { email, password, full_name, role } = req.body;
  if (!['system_admin', 'business_admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (role === 'system_admin' && email !== IMMUTABLE_EMAIL) {
    return res.status(403).json({ error: 'The system admin seat is reserved for the primary administrator.' });
  }
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE platform_admins IN EXCLUSIVE MODE');
    const { rows: [roleSeat] } = await client.query(
      'SELECT id, email FROM platform_admins WHERE role = $1 AND is_active = true',
      [role]
    );
    if (roleSeat) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: `${ADMIN_ROLE_LABELS[role]} already has an active administrator.` });
    }
    const hash = await bcrypt.hash(password, 12);
    const newAdmin = await client.query(
      `INSERT INTO platform_admins (email, password_hash, full_name, role) VALUES ($1,$2,$3,$4) RETURNING id, email, full_name, role`,
      [email, hash, full_name, role]
    );
    await client.query('COMMIT');
    res.status(201).json(newAdmin.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error creating admin:', e);
    res.status(500).json({ error: 'Failed to create admin: ' + e.message });
  } finally {
    client.release();
  }
});

router.post('/invitations', authenticate, requireRole('business_admin'), async (req, res) => {
  const { email, role } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!['supplier', 'customer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role for invitation. Must be supplier or customer.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Check if user already exists
    const { rows: existing } = await client.query(
      `SELECT email FROM (
        SELECT email FROM platform_admins UNION ALL
        SELECT email FROM tenant_users UNION ALL
        SELECT email FROM supplier_users
      ) u WHERE email=$1 LIMIT 1`,
      [email]
    );
    
    if (existing.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

    await client.query(
      `INSERT INTO invitations (email, role, token, expires_at, invited_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [email, role, token, expiresAt, req.user.user_id]
    );
    
    await client.query('COMMIT');
    
    await sendInvitation(email, token, req.user.full_name || 'Business Admin');
    
    res.json({ message: 'Invitation sent successfully', email });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error creating invitation:', e);
    res.status(500).json({ error: 'Failed to create invitation' });
  } finally {
    client.release();
  }
});

module.exports = router;
