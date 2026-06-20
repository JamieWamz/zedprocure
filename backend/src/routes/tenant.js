const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

router.get('/tenant/bids', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'tenant_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const tenantId = req.user.tenant_id;
  if (!tenantId) return res.status(400).json({ error: 'No tenant associated' });
  const { rows } = await pool.query(
    'SELECT * FROM bids WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId]
  );
  res.json(rows);
});

module.exports = router;