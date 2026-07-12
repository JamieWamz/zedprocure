const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { jwtSecret } = require('../config/auth');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Rate limiting: max 10 login attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const queries = [
    { text: 'SELECT id, email, password_hash, full_name, \'platform_admin\' AS user_type, role FROM platform_admins WHERE email=$1 AND is_active=true', param: [email] },
    { text: 'SELECT id, email, password_hash, full_name, \'tenant_user\' AS user_type, role, tenant_id FROM tenant_users WHERE email=$1 AND is_active=true', param: [email] },
    { text: 'SELECT id, email, password_hash, full_name, \'supplier_user\' AS user_type, \'supplier_user\' AS role FROM supplier_users WHERE email=$1 AND is_active=true', param: [email] },
  ];

  for (const q of queries) {
    const { rows } = await pool.query(q.text, q.param);
    if (rows.length) {
      const user = rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) continue;

      let tenant_id = user.tenant_id || null;

      // Business admin: require explicit tenant association rather than auto-assigning
      // to the first active tenant (which is fragile). Business admins operate across
      // tenants and should have tenant_id set explicitly in their profile or passed via request.
      if (user.user_type === 'platform_admin' && user.role === 'business_admin' && !tenant_id) {
        // Business admin without a tenant_id can still log in - they'll see all tenants
        // tenant_id remains null and they can select a tenant from the UI
      }

      const token = jwt.sign(
        { user_id: user.id, user_type: user.user_type, role: user.role, tenant_id },
        jwtSecret,
        { expiresIn: '12h' }
      );

      // Update last_login for all user types
      if (user.user_type === 'platform_admin') {
        await pool.query('UPDATE platform_admins SET last_login=now() WHERE id=$1', [user.id]);
      } else if (user.user_type === 'tenant_user') {
        await pool.query('UPDATE tenant_users SET last_login=now() WHERE id=$1', [user.id]);
      } else if (user.user_type === 'supplier_user') {
        await pool.query('UPDATE supplier_users SET last_login=now() WHERE id=$1', [user.id]);
      }

      return res.json({ access_token: token, expires_in: 43200 });
    }
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

module.exports = router;