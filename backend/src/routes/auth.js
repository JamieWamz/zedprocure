const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { jwtSecret } = require('../config/auth');
const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const queries = [
    { text: 'SELECT id, email, password_hash, full_name, \'platform_admin\' AS user_type, role FROM platform_admins WHERE email=$1 AND is_active=true', param: [email] },
    { text: 'SELECT id, email, password_hash, full_name, \'tenant_user\' AS user_type, role FROM tenant_users WHERE email=$1 AND is_active=true', param: [email] },
    { text: 'SELECT id, email, password_hash, full_name, \'supplier_user\' AS user_type, \'supplier_user\' AS role FROM supplier_users WHERE email=$1 AND is_active=true', param: [email] },
  ];

  for (const q of queries) {
    const { rows } = await pool.query(q.text, q.param);
    if (rows.length) {
      const user = rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) continue;

      let tenant_id = null;
      if (user.user_type === 'tenant_user') {
        const { rows: tenantRows } = await pool.query(
          'SELECT tenant_id FROM tenant_users WHERE id = $1',
          [user.id]
        );
        tenant_id = tenantRows[0]?.tenant_id;
      } else if (user.user_type === 'platform_admin' && user.role === 'business_admin') {
        const { rows: tenantRows } = await pool.query(
          'SELECT id FROM tenants WHERE is_active = true ORDER BY created_at LIMIT 1'
        );
        if (tenantRows.length > 0) tenant_id = tenantRows[0].id;
      }

      const token = jwt.sign(
        { user_id: user.id, user_type: user.user_type, role: user.role, tenant_id },
        jwtSecret,
        { expiresIn: '12h' }
      );

      if (user.user_type === 'platform_admin') {
        await pool.query('UPDATE platform_admins SET last_login=now() WHERE id=$1', [user.id]);
      }
      return res.json({ access_token: token, expires_in: 43200 });
    }
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

module.exports = router;
