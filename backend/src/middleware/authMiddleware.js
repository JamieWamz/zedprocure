const jwt = require('jsonwebtoken');
const { jwtSecret, TOKEN_COOKIE } = require('../config/auth');
const pool = require('../config/db');

function extractToken(req) {
  // Prefer the httpOnly cookie (set on login); fall back to Bearer header for API clients.
  if (req.cookies && req.cookies[TOKEN_COOKIE]) return req.cookies[TOKEN_COOKIE];
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.split(' ')[1];
  return null;
}

function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(token, jwtSecret);

    // Verify user still exists and is active in the database
    verifyUserActive(decoded)
      .then(user => {
        req.user = user;
        next();
      })
      .catch(err => {
        return res.status(401).json({ error: err.message });
      });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function verifyUserActive(decoded) {
  const { user_id, user_type } = decoded;
  let result;

  if (user_type === 'platform_admin') {
    result = await pool.query(
      'SELECT id, email, full_name, role, is_active FROM platform_admins WHERE id = $1',
      [user_id]
    );
  } else if (user_type === 'tenant_user') {
    result = await pool.query(
      'SELECT id, email, full_name, role, tenant_id, is_active FROM tenant_users WHERE id = $1',
      [user_id]
    );
  } else if (user_type === 'supplier_user') {
    result = await pool.query(
      'SELECT su.id, su.email, su.full_name, su.is_active, s.verification_status FROM supplier_users su JOIN suppliers s ON s.id = su.supplier_id WHERE su.id = $1',
      [user_id]
    );
  } else {
    throw new Error('Invalid user type');
  }

  if (!result.rows.length || !result.rows[0].is_active) {
    throw new Error('User account is disabled or not found');
  }

  // Return the full decoded payload with fresh data
  return {
    ...decoded,
    ...result.rows[0]
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

module.exports = { authenticate, requireRole };