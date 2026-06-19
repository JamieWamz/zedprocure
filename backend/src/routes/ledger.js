const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const router = express.Router();

router.get('/accounts', authenticate, requireRole('business_admin'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM accounts ORDER BY account_code');
  res.json(rows);
});

router.get('/journal', authenticate, requireRole('business_admin'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT je.*, json_agg(json_build_object('account_code', a.account_code, 'debit', jl.debit, 'credit', jl.credit)) as lines
     FROM journal_entries je
     JOIN journal_lines jl ON jl.journal_entry_id = je.id
     JOIN accounts a ON a.id = jl.account_id
     GROUP BY je.id ORDER BY je.entry_date DESC LIMIT 100`
  );
  res.json(rows);
});

module.exports = router;
