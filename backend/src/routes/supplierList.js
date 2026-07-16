const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

router.get('/suppliers/verified', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, company_name FROM suppliers WHERE verification_status = 'verified' ORDER BY company_name"
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching verified suppliers:', e);
    res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
});

module.exports = router;
