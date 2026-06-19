const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

router.get('/tenant/bids', authenticate, async (req, res) => {
  if (req.user.user_type !== 'tenant_user' || req.user.role !== 'tenant_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { rows } = await pool.query(
    'SELECT * FROM bids WHERE tenant_id = $1 ORDER BY created_at DESC',
    [req.user.tenant_id]
  );
  res.json(rows);
});

module.exports = router;