const express = require('express');
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { validatePassword } = require('../utils/passwordValidation');
const { cleanText } = require('../utils/requestValidation');
const {
  assertIdentityEmailAvailable,
  requireValidIdentityEmail,
} = require('../services/identityEmailGuard');
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
  const { password, role } = req.body;
  let email;
  let fullName;
  try {
    email = requireValidIdentityEmail(req.body.email);
    fullName = cleanText(req.body.full_name, { required: true, maxLength: 150 });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (!['system_admin', 'business_admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (role === 'system_admin' && email !== IMMUTABLE_EMAIL) {
    return res.status(403).json({ error: 'The system admin seat is reserved for the primary administrator.' });
  }
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query('LOCK TABLE platform_admins IN EXCLUSIVE MODE');
    await assertIdentityEmailAvailable(client, email);
    const { rows: [roleSeat] } = await client.query(
      'SELECT id, email FROM platform_admins WHERE role = $1 AND is_active = true',
      [role]
    );
    if (roleSeat) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ error: `${ADMIN_ROLE_LABELS[role]} already has an active administrator.` });
    }
    const hash = await bcrypt.hash(password, 12);
    const newAdmin = await client.query(
      `INSERT INTO platform_admins (email, password_hash, full_name, role) VALUES ($1,$2,$3,$4) RETURNING id, email, full_name, role`,
      [email, hash, fullName, role]
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1, $2, $3, 'platform_admin_created', 'platform_admin', $4, $5)`,
      [
        req.user.id || req.user.user_id,
        req.user.user_type || 'platform_admin',
        req.user.email || null,
        newAdmin.rows[0].id,
        JSON.stringify({ role, is_active: true }),
      ]
    );
    await client.query('COMMIT');
    transactionStarted = false;
    res.status(201).json(newAdmin.rows[0]);
  } catch (e) {
    if (transactionStarted && client) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be unavailable */ }
    }
    if (e.statusCode === 409) {
      return res.status(409).json({ error: e.message });
    }
    if (e.code === '23505') {
      const isSeatConflict = e.constraint === 'platform_admins_one_active_role_idx';
      return res.status(isSeatConflict ? 403 : 409).json({
        error: isSeatConflict
          ? `${ADMIN_ROLE_LABELS[role]} already has an active administrator.`
          : 'An account with this email already exists',
      });
    }
    console.error('Error creating admin:', e);
    res.status(500).json({ error: 'Failed to create admin' });
  } finally {
    client?.release();
  }
});

router.post('/invitations', authenticate, requireRole('business_admin'), async (req, res) => {
  const { role } = req.body;
  let email;
  try {
    email = requireValidIdentityEmail(req.body.email);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (!['supplier', 'customer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role for invitation. Must be supplier or customer.' });
  }

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    await assertIdentityEmailAvailable(client, email);

    const { rows: existingInvitations } = await client.query(
      `SELECT id FROM invitations
       WHERE LOWER(BTRIM(email)) = $1
         AND accepted = false
         AND expires_at > NOW()
       LIMIT 1`,
      [email]
    );
    if (existingInvitations.length) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'An active invitation for this email already exists' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

    await client.query(
      `INSERT INTO invitations (email, role, token, expires_at, invited_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [email, role, token, expiresAt, req.user.id || req.user.user_id]
    );
    
    await client.query('COMMIT');
    transactionStarted = false;
    
    let emailDelivered = true;
    try {
      await sendInvitation(email, token, req.user.full_name || 'Business Admin');
    } catch (deliveryError) {
      emailDelivered = false;
      console.error('Invitation email could not be sent:', deliveryError.message);
    }

    res.json({
      message: emailDelivered
        ? 'Invitation sent successfully'
        : 'Invitation created, but email delivery is temporarily unavailable',
      email,
      email_delivered: emailDelivered,
    });
  } catch (e) {
    if (transactionStarted && client) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be unavailable */ }
    }
    if (e.statusCode === 409) {
      return res.status(409).json({ error: e.message });
    }
    if (e.code === '23505') {
      return res.status(409).json({ error: 'An invitation or account with this email already exists' });
    }
    console.error('Error creating invitation:', e);
    res.status(500).json({ error: 'Failed to create invitation' });
  } finally {
    client?.release();
  }
});

module.exports = router;
