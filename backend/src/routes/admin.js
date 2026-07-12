const express = require('express');
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { validatePassword } = require('../utils/validation');
const router = express.Router();
const IMMUTABLE_EMAIL = 'wamuyuwamundia@gmail.com';

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
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE platform_admins IN EXCLUSIVE MODE');
    const { rows } = await client.query(
      'SELECT COUNT(*) as cnt FROM platform_admins WHERE is_active = true AND email != $1',
      [IMMUTABLE_EMAIL]
    );
    if (parseInt(rows[0].cnt) >= 3) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Maximum 3 additional active administrators allowed.' });
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

module.exports = router;
