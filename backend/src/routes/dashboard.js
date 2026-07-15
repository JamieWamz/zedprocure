/**
 * Business Admin Dashboard — financial KPIs, revenue, profits, outstanding payments,
 * cash flow summaries, and key business metrics.
 */
const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const router = express.Router();

router.get('/dashboard/summary', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  try {
    const results = await Promise.all([
      // ─── Revenue & Profit ──────────────────────────────────────────────
      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN a.account_type='revenue' THEN jl.credit - jl.debit ELSE 0 END), 0) AS total_revenue,
          COALESCE(SUM(CASE WHEN a.account_type='expense' THEN jl.debit - jl.credit ELSE 0 END), 0) AS total_expenses,
          COALESCE(SUM(CASE WHEN a.account_code='CASH_BANK' THEN jl.debit - jl.credit ELSE 0 END), 0) AS cash_bank,
          COALESCE(SUM(CASE WHEN a.account_code='ESCROW_CASH' THEN jl.debit - jl.credit ELSE 0 END), 0) AS escrow_cash
        FROM journal_entries je
        JOIN journal_lines jl ON jl.journal_entry_id = je.id
        JOIN accounts a ON a.id = jl.account_id
        WHERE je.approved = true
      `),

      // ─── Outstanding Payments (pending escrow) ─────────────────────────
      pool.query(`
        SELECT
          COUNT(*) AS count,
          COALESCE(SUM(amount), 0) AS total_outstanding
        FROM escrow_accounts
        WHERE status IN ('pending_funding', 'funded')
      `),

      // ─── Platform Stats ────────────────────────────────────────────────
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM bids WHERE status != 'cancelled') AS total_bids,
          (SELECT COUNT(*) FROM bids WHERE status IN ('open','evaluation')) AS active_bids,
          (SELECT COUNT(*) FROM suppliers WHERE verification_status = 'verified') AS verified_suppliers,
          (SELECT COUNT(*) FROM suppliers WHERE verification_status IN ('pending','documents_submitted')) AS pending_suppliers,
          (SELECT COUNT(*) FROM orders) AS total_orders,
          (SELECT COUNT(*) FROM orders WHERE status = 'completed') AS completed_orders,
          (SELECT COUNT(*) FROM orders WHERE status = 'disputed') AS disputed_orders,
          (SELECT COUNT(*) FROM tenant_users) AS platform_users,
          (SELECT COUNT(*) FROM tenants) AS organizations
      `),

      // ─── Monthly Revenue (last 12 months) ──────────────────────────────
      pool.query(`
        SELECT
          to_char(je.created_at, 'Mon') AS month,
          to_char(je.created_at, 'YYYY-MM') AS month_key,
          EXTRACT(YEAR FROM je.created_at) AS year,
          COALESCE(SUM(jl.credit - jl.debit), 0) AS revenue
        FROM journal_entries je
        JOIN journal_lines jl ON jl.journal_entry_id = je.id
        JOIN accounts a ON a.id = jl.account_id
        WHERE je.approved = true
          AND a.account_type = 'revenue'
          AND je.created_at >= NOW() - INTERVAL '12 months'
        GROUP BY month_key, year, month
        ORDER BY MIN(je.created_at)
      `),

      // ─── Escrow Summary ────────────────────────────────────────────────
      pool.query(`
        SELECT
          ea.status,
          COUNT(*) AS count,
          COALESCE(SUM(ea.amount), 0) AS total
        FROM escrow_accounts ea
        GROUP BY ea.status
        ORDER BY ea.status
      `),

      // ─── Recent Transactions ───────────────────────────────────────────
      pool.query(`
        SELECT pt.id, pt.transaction_ref, pt.amount, pt.type, pt.status, pt.created_at,
          COALESCE(su.full_name, tu.full_name, pa.full_name, 'Unknown') AS from_name
        FROM payment_transactions pt
        LEFT JOIN platform_admins pa ON pa.id = pt.from_user_id
        LEFT JOIN tenant_users tu ON tu.id = pt.from_user_id
        LEFT JOIN supplier_users su ON su.id = pt.from_user_id
        ORDER BY pt.created_at DESC
        LIMIT 20
      `),

      // ─── Invoice Control Tower ─────────────────────────────────────────
      pool.query(`
        SELECT
          COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE type='AR' AND status IN ('sent','partially_paid')), 0) AS ar_open,
          COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE type='AR' AND due_date < CURRENT_DATE AND status IN ('sent','partially_paid')), 0) AS ar_overdue,
          COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE type='AP' AND status IN ('sent','partially_paid')), 0) AS ap_open,
          COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE type='AP' AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' AND status IN ('sent','partially_paid')), 0) AS ap_due_soon,
          COUNT(*) FILTER (WHERE status='draft') AS draft_count,
          COUNT(*) FILTER (WHERE status IN ('sent','partially_paid')) AS open_count,
          COUNT(*) FILTER (WHERE status='paid') AS paid_count,
          COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status IN ('sent','partially_paid')) AS overdue_count,
          COALESCE(SUM(paid_amount) FILTER (WHERE updated_at >= date_trunc('month', CURRENT_DATE)), 0) AS paid_this_month
        FROM invoices
      `),

      // ─── Procurement Command Center ───────────────────────────────────
      pool.query(`
        SELECT status, COUNT(*)::int AS count
        FROM bids
        GROUP BY status
        ORDER BY status
      `),

      pool.query(`
        SELECT status, COUNT(*)::int AS count, COALESCE(SUM(total_amount), 0) AS total
        FROM orders
        GROUP BY status
        ORDER BY status
      `),

      pool.query(`
        SELECT b.id, b.title, t.name AS tenant_name, b.deadline,
               COUNT(bs.id)::int AS invited,
               COUNT(bs.id) FILTER (WHERE bs.accepted IS TRUE)::int AS accepted,
               COUNT(sr.id)::int AS responses
        FROM bids b
        JOIN tenants t ON t.id = b.tenant_id
        LEFT JOIN bid_suppliers bs ON bs.bid_id = b.id
        LEFT JOIN supplier_responses sr ON sr.bid_supplier_id = bs.id
        WHERE b.status IN ('open','evaluation')
        GROUP BY b.id, b.title, t.name, b.deadline
        ORDER BY b.deadline ASC
        LIMIT 8
      `),

      pool.query(`
        SELECT s.id, s.company_name,
               COUNT(o.id)::int AS orders,
               COALESCE(SUM(o.total_amount), 0) AS total_awarded,
               COUNT(o.id) FILTER (WHERE o.status='completed')::int AS completed
        FROM suppliers s
        JOIN orders o ON o.awarded_supplier_id = s.id
        GROUP BY s.id, s.company_name
        ORDER BY total_awarded DESC
        LIMIT 5
      `),
    ]);

    const revenue = results[0].rows[0];
    const outstanding = results[1].rows[0];
    const stats = results[2].rows[0];
    const monthlyRevenue = results[3].rows;
    const escrowSummary = results[4].rows;
    const recentTransactions = results[5].rows;
    const invoices = results[6].rows[0];
    const bidPipeline = results[7].rows;
    const orderPipeline = results[8].rows;
    const urgentBids = results[9].rows;
    const topSuppliers = results[10].rows;

    const netProfit = parseFloat(revenue.total_revenue) - parseFloat(revenue.total_expenses);
    const profitMargin = parseFloat(revenue.total_revenue) > 0
      ? (netProfit / parseFloat(revenue.total_revenue)) * 100
      : 0;

    res.json({
      revenue: {
        total: parseFloat(revenue.total_revenue).toFixed(2),
        expenses: parseFloat(revenue.total_expenses).toFixed(2),
        netProfit: netProfit.toFixed(2),
        profitMargin: profitMargin.toFixed(1),
        cashBank: parseFloat(revenue.cash_bank).toFixed(2),
        escrowCash: parseFloat(revenue.escrow_cash).toFixed(2),
      },
      outstanding: {
        count: parseInt(outstanding.count, 10),
        total: parseFloat(outstanding.total_outstanding).toFixed(2),
      },
      stats: {
        totalBids: parseInt(stats.total_bids, 10),
        activeBids: parseInt(stats.active_bids, 10),
        verifiedSuppliers: parseInt(stats.verified_suppliers, 10),
        pendingSuppliers: parseInt(stats.pending_suppliers, 10),
        totalOrders: parseInt(stats.total_orders, 10),
        completedOrders: parseInt(stats.completed_orders, 10),
        disputedOrders: parseInt(stats.disputed_orders, 10),
        platformUsers: parseInt(stats.platform_users, 10),
        organizations: parseInt(stats.organizations, 10),
      },
      monthlyRevenue: monthlyRevenue.map(r => ({
        month: r.month,
        monthKey: r.month_key,
        revenue: parseFloat(r.revenue).toFixed(2),
      })),
      escrowSummary: escrowSummary.reduce((acc, r) => {
        acc[r.status] = { count: parseInt(r.count, 10), total: parseFloat(r.total).toFixed(2) };
        return acc;
      }, {}),
      recentTransactions: recentTransactions.map(t => ({
        id: t.id,
        ref: t.transaction_ref,
        amount: parseFloat(t.amount).toFixed(2),
        type: t.type,
        status: t.status,
        fromName: t.from_name,
        date: t.created_at,
      })),
      invoices: {
        arOpen: parseFloat(invoices.ar_open).toFixed(2),
        arOverdue: parseFloat(invoices.ar_overdue).toFixed(2),
        apOpen: parseFloat(invoices.ap_open).toFixed(2),
        apDueSoon: parseFloat(invoices.ap_due_soon).toFixed(2),
        paidThisMonth: parseFloat(invoices.paid_this_month).toFixed(2),
        counts: {
          draft: parseInt(invoices.draft_count || 0, 10),
          open: parseInt(invoices.open_count || 0, 10),
          paid: parseInt(invoices.paid_count || 0, 10),
          overdue: parseInt(invoices.overdue_count || 0, 10),
        },
      },
      procurement: {
        bidPipeline: bidPipeline.map(row => ({ status: row.status, count: parseInt(row.count, 10) })),
        orderPipeline: orderPipeline.map(row => ({
          status: row.status,
          count: parseInt(row.count, 10),
          total: parseFloat(row.total || 0).toFixed(2),
        })),
        urgentBids: urgentBids.map(row => ({
          id: row.id,
          title: row.title,
          tenantName: row.tenant_name,
          deadline: row.deadline,
          invited: parseInt(row.invited || 0, 10),
          accepted: parseInt(row.accepted || 0, 10),
          responses: parseInt(row.responses || 0, 10),
        })),
        topSuppliers: topSuppliers.map(row => ({
          id: row.id,
          companyName: row.company_name,
          orders: parseInt(row.orders || 0, 10),
          completed: parseInt(row.completed || 0, 10),
          totalAwarded: parseFloat(row.total_awarded || 0).toFixed(2),
        })),
      },
    });
  } catch (e) {
    console.error('Dashboard error:', e);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// ─── In-app Wallet: Get balance ──────────────────────────────────────────────
router.get('/wallet', authenticate, async (req, res) => {
  try {
    const { rows: [wallet] } = await pool.query(
      `SELECT id, balance FROM wallets WHERE user_id=$1 AND user_type=$2`,
      [req.user.user_id, req.user.user_type]
    );
    if (!wallet) {
      return res.json({ balance: '0.00', transactions: [] });
    }
    const { rows: txns } = await pool.query(
      `SELECT * FROM wallet_transactions WHERE wallet_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [wallet.id]
    );
    res.json({ balance: parseFloat(wallet.balance).toFixed(2), transactions: txns });
  } catch (e) {
    console.error('Wallet error:', e);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// ─── In-app Transfer ─────────────────────────────────────────────────────────
router.post('/wallet/transfer', authenticate, async (req, res) => {
  const { to_email, amount, description } = req.body;
  if (!to_email || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Recipient email and positive amount required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock sender wallet
    const { rows: [senderWallet] } = await client.query(
      `SELECT * FROM wallets WHERE user_id=$1 AND user_type=$2 FOR UPDATE`,
      [req.user.user_id, req.user.user_type]
    );
    if (!senderWallet || parseFloat(senderWallet.balance) < parseFloat(amount)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Find recipient wallet
    const { rows: [recipient] } = await client.query(
      `SELECT id, user_id, user_type, balance FROM wallets WHERE user_id IN (
        SELECT id FROM tenant_users WHERE email=$1 AND is_active=true
        UNION ALL SELECT id FROM supplier_users WHERE email=$1
        UNION ALL SELECT id FROM platform_admins WHERE email=$1 AND is_active=true
      ) LIMIT 1`,
      [to_email]
    );
    if (!recipient) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Recipient not found' });
    }

    const txId = require('crypto').randomUUID();
    const amt = parseFloat(amount);

    // Debit sender
    await client.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, balance_before, balance_after, description)
       VALUES ($1, $2, 'transfer_out', $3, $4, $5, $6)`,
      [txId, senderWallet.id, amt, senderWallet.balance, parseFloat(senderWallet.balance) - amt, description || `Transfer to ${to_email}`]
    );
    await client.query(`UPDATE wallets SET balance=$1, updated_at=NOW() WHERE id=$2`,
      [parseFloat(senderWallet.balance) - amt, senderWallet.id]);

    // Credit recipient
    await client.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, balance_before, balance_after, description)
       VALUES ($1, $2, 'transfer_in', $3, $4, $5, $6)`,
      [require('crypto').randomUUID(), recipient.id, amt, parseFloat(recipient.balance), parseFloat(recipient.balance) + amt, `Transfer from ${req.user.email}`]
    );
    await client.query(`UPDATE wallets SET balance=$1, updated_at=NOW() WHERE id=$2`,
      [parseFloat(recipient.balance) + amt, recipient.id]);

    await client.query('COMMIT');
    const { rows: [updated] } = await pool.query('SELECT balance FROM wallets WHERE id=$1', [senderWallet.id]);
    res.json({ message: 'Transfer completed', balance: parseFloat(updated.balance).toFixed(2) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Transfer error:', e);
    res.status(500).json({ error: 'Transfer failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
