const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

router.get('/suppliers/verified', authenticate, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, company_name FROM suppliers WHERE verification_status = 'verified'"
  );
  res.json(rows);
});

module.exports = router;
