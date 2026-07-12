const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { jwtSecret, ACCESS_TTL, REFRESH_TTL, cookieOptions, TOKEN_COOKIE, REFRESH_COOKIE } = require('../config/auth');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Rate limiting: max 10 login attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' }
});

function signTokens(user) {
  const payload = { user_id: user.id, user_type: user.user_type, role: user.role, tenant_id: user.tenant_id || null };
  const accessToken = jwt.sign(payload, jwtSecret, { expiresIn: ACCESS_TTL });
  const refreshToken = jwt.sign({ user_id: user.id }, jwtSecret, { expiresIn: REFRESH_TTL });
  return { accessToken, refreshToken };
}

// Resolves a user's auth profile (type/role/tenant) by id across all user tables.
async function getUserAuthProfile(id) {
  const { rows } = await pool.query(
    `SELECT id, 'platform_admin' AS user_type, role, tenant_id FROM platform_admins WHERE id=$1 AND is_active=true
     UNION ALL
     SELECT id, 'tenant_user' AS user_type, role, tenant_id FROM tenant_users WHERE id=$1 AND is_active=true
     UNION ALL
     SELECT id, 'supplier_user' AS user_type, 'supplier_user' AS role, NULL AS tenant_id FROM supplier_users WHERE id=$1 AND is_active=true`,
    [id]
  );
  return rows[0] || null;
}

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie(TOKEN_COOKIE, accessToken, cookieOptions);
  res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

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

      const { accessToken, refreshToken } = signTokens(user);
      setAuthCookies(res, accessToken, refreshToken);

      // Update last_login for all user types
      if (user.user_type === 'platform_admin') {
        await pool.query('UPDATE platform_admins SET last_login=now() WHERE id=$1', [user.id]);
      } else if (user.user_type === 'tenant_user') {
        await pool.query('UPDATE tenant_users SET last_login=now() WHERE id=$1', [user.id]);
      } else if (user.user_type === 'supplier_user') {
        await pool.query('UPDATE supplier_users SET last_login=now() WHERE id=$1', [user.id]);
      }

      return res.json({ success: true });
    }
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// Refresh the short-lived access token using the refresh cookie.
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies && req.cookies[REFRESH_COOKIE];
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });
  try {
    const decoded = jwt.verify(refreshToken, jwtSecret);
    const profile = await getUserAuthProfile(decoded.user_id);
    if (!profile) return res.status(401).json({ error: 'User not found or disabled' });

    const { accessToken, refreshToken: newRefresh } = signTokens(profile);
    setAuthCookies(res, accessToken, newRefresh);
    res.json({ success: true });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(TOKEN_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  res.json({ success: true });
});

module.exports = router;
