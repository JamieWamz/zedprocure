const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const router = express.Router();

// Only approved, posted entries count toward financial statements.
const POSTED_JOURNAL_JOIN = `LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.approved = true`;
const POSTED_DEBIT = `COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit ELSE 0 END), 0)`;
const POSTED_CREDIT = `COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit ELSE 0 END), 0)`;

function normalBalance(type, debit, credit) {
  if (['asset', 'expense'].includes(type)) return debit - credit;
  return credit - debit;
}

// ─── Chart of accounts with live balances ────────────────────────────────────
router.get('/accounts', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.account_code, a.account_name, a.account_type,
              ${POSTED_DEBIT} AS total_debit,
              ${POSTED_CREDIT} AS total_credit
       FROM accounts a
       LEFT JOIN journal_lines jl ON jl.account_id = a.id
       ${POSTED_JOURNAL_JOIN}
       GROUP BY a.id
       ORDER BY a.account_code LIMIT 200`
    );
    const accounts = rows.map(r => {
      const debit = parseFloat(r.total_debit);
      const credit = parseFloat(r.total_credit);
      const balance = normalBalance(r.account_type, debit, credit);
      return {
        code: r.account_code,
        name: r.account_name,
        type: r.account_type,
        debit,
        credit,
        balance: balance.toFixed(2),
      };
    });
    res.json(accounts);
  } catch (e) {
    console.error('Error fetching accounts:', e);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// ─── Trial balance ───────────────────────────────────────────────────────────
router.get('/trial-balance', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.account_code, a.account_name, a.account_type,
              ${POSTED_DEBIT} AS debit,
              ${POSTED_CREDIT} AS credit
       FROM accounts a
       LEFT JOIN journal_lines jl ON jl.account_id = a.id
       ${POSTED_JOURNAL_JOIN}
       GROUP BY a.id
       ORDER BY a.account_code`
    );
    let totalDebit = 0, totalCredit = 0;
    const lines = rows.map(r => {
      const debit = parseFloat(r.debit);
      const credit = parseFloat(r.credit);
      const balance = normalBalance(r.account_type, debit, credit);
      totalDebit += debit;
      totalCredit += credit;
      return {
        code: r.account_code,
        name: r.account_name,
        type: r.account_type,
        debit: debit.toFixed(2),
        credit: credit.toFixed(2),
        balance: balance.toFixed(2),
        normalBalance: ['asset', 'expense'].includes(r.account_type) ? 'debit' : 'credit',
      };
    });
    res.json({
      lines,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
      balanced: Math.abs(totalDebit - totalCredit) < 0.005,
    });
  } catch (e) {
    console.error('Trial balance error:', e);
    res.status(500).json({ error: 'Failed to compute trial balance' });
  }
});

// ─── Income statement (Profit & Loss) ────────────────────────────────────────
router.get('/income-statement', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.account_type,
              ${POSTED_DEBIT} AS debit,
              ${POSTED_CREDIT} AS credit
       FROM accounts a
       LEFT JOIN journal_lines jl ON jl.account_id = a.id
       ${POSTED_JOURNAL_JOIN}
       WHERE a.account_type IN ('revenue','expense')
       GROUP BY a.account_type`
    );
    let revenue = 0, expenses = 0;
    for (const r of rows) {
      if (r.account_type === 'revenue') revenue = parseFloat(r.credit) - parseFloat(r.debit);
      if (r.account_type === 'expense') expenses = parseFloat(r.debit) - parseFloat(r.credit);
    }
    const netProfit = revenue - expenses;
    res.json({
      revenue: revenue.toFixed(2),
      expenses: expenses.toFixed(2),
      netProfit: netProfit.toFixed(2),
      margin: revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) : '0.0',
    });
  } catch (e) {
    console.error('Income statement error:', e);
    res.status(500).json({ error: 'Failed to compute income statement' });
  }
});

// ─── Balance sheet ───────────────────────────────────────────────────────────
router.get('/balance-sheet', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.account_type,
              ${POSTED_DEBIT} AS debit,
              ${POSTED_CREDIT} AS credit
       FROM accounts a
       LEFT JOIN journal_lines jl ON jl.account_id = a.id
       ${POSTED_JOURNAL_JOIN}
       WHERE a.account_type IN ('asset','liability','equity','revenue','expense')
       GROUP BY a.account_type`
    );
    const byType = {};
    for (const r of rows) {
      byType[r.account_type] = normalBalance(r.account_type, parseFloat(r.debit), parseFloat(r.credit));
    }
    const assets = byType.asset || 0;
    const liabilities = byType.liability || 0;
    const equity = byType.equity || 0;
    const revenue = byType.revenue || 0;
    const expense = byType.expense || 0;
    const retainedEarnings = revenue - expense; // net profit retained
    const totalLiabilitiesEquity = liabilities + equity + retainedEarnings;

    res.json({
      assets: assets.toFixed(2),
      liabilities: liabilities.toFixed(2),
      equity: equity.toFixed(2),
      retainedEarnings: retainedEarnings.toFixed(2),
      totalLiabilitiesEquity: totalLiabilitiesEquity.toFixed(2),
      balanced: Math.abs(assets - totalLiabilitiesEquity) < 0.005,
    });
  } catch (e) {
    console.error('Balance sheet error:', e);
    res.status(500).json({ error: 'Failed to compute balance sheet' });
  }
});

// ─── Cash flow summary ──────────────────────────────────────────────────────
router.get('/cash-flow', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
          to_char(date_trunc('month', je.entry_date), 'YYYY-MM') AS month_key,
          to_char(date_trunc('month', je.entry_date), 'Mon YYYY') AS month,
          COALESCE(SUM(jl.debit), 0) AS cash_in,
          COALESCE(SUM(jl.credit), 0) AS cash_out
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id
       JOIN accounts a ON a.id = jl.account_id
       WHERE je.approved = true
         AND a.account_code IN ('CASH_BANK', 'ESCROW_CASH')
         AND je.entry_date >= NOW() - INTERVAL '12 months'
       GROUP BY month_key, month
       ORDER BY month_key`
    );
    let net = 0;
    res.json(rows.map(r => {
      const cashIn = parseFloat(r.cash_in);
      const cashOut = parseFloat(r.cash_out);
      net += cashIn - cashOut;
      return {
        month: r.month,
        monthKey: r.month_key,
        cashIn: cashIn.toFixed(2),
        cashOut: cashOut.toFixed(2),
        net: (cashIn - cashOut).toFixed(2),
        runningNet: net.toFixed(2),
      };
    }));
  } catch (e) {
    console.error('Cash flow error:', e);
    res.status(500).json({ error: 'Failed to compute cash flow' });
  }
});

// ─── Journal entries (filtered + paginated) ──────────────────────────────────
router.get('/journal', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  try {
    const { from, to, account, search, limit = 100, offset = 0 } = req.query;
    const where = [];
    const params = [];
    let i = 1;
    if (from) { where.push(`je.entry_date >= $${i++}`); params.push(from); }
    if (to) { where.push(`je.entry_date <= $${i++}::timestamp + interval '1 day'`); params.push(to); }
    if (account) { where.push(`a.account_code = $${i++}`); params.push(account); }
    if (search) {
      where.push(`(je.description ILIKE $${i} OR je.reference_type ILIKE $${i + 1})`);
      params.push(`%${search}%`, `%${search}%`);
      i += 2;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const limitIdx = i++;
    const offsetIdx = i++;
    const { rows } = await pool.query(
      `SELECT je.*, json_agg(json_build_object('account_code', a.account_code, 'account_name', a.account_name, 'debit', jl.debit, 'credit', jl.credit)) AS lines
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id
       JOIN accounts a ON a.id = jl.account_id
       ${whereSql}
       GROUP BY je.id
       ORDER BY je.entry_date DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, parseInt(limit, 10), parseInt(offset, 10)]
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching journal:', e);
    res.status(500).json({ error: 'Failed to fetch journal entries' });
  }
});

module.exports = router;
