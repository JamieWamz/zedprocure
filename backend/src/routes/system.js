const express = require('express');
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { validatePassword } = require('../utils/validation');
const os = require('os');
const router = express.Router();

const IMMUTABLE_EMAIL = process.env.SYSTEM_ADMIN_EMAIL || 'system.admin@freshstart.local';
const ADMIN_ROLE_LABELS = {
  system_admin: 'System Admin',
  business_admin: 'Business Admin',
};

// ─── System Stats ───────────────────────────────────────────
router.get('/system/stats', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
    const [
      bidsRes,
      tenantsRes,
      suppliersRes,
      usersRes,
      cashRes,
      ordersRes,
      invoicesRes,
      adminsRes,
      journalRes,
      auditRes,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total,
                         COUNT(*) FILTER (WHERE status IN ('open','evaluation'))::int AS active,
                         COUNT(*) FILTER (WHERE status='awarded')::int AS awarded
                  FROM bids`),
      pool.query(`SELECT COUNT(*)::int AS total,
                         COUNT(*) FILTER (WHERE is_active=true)::int AS active
                  FROM tenants`),
      pool.query(`SELECT COUNT(*)::int AS total,
                         COUNT(*) FILTER (WHERE verification_status='verified')::int AS verified,
                         COUNT(*) FILTER (WHERE verification_status IN ('pending','documents_submitted'))::int AS pending
                  FROM suppliers`),
      pool.query(`SELECT
                    (SELECT COUNT(*) FROM tenant_users) + (SELECT COUNT(*) FROM supplier_users) + (SELECT COUNT(*) FROM platform_admins) AS total,
                    (SELECT COUNT(*) FROM tenant_users WHERE is_active=true) + (SELECT COUNT(*) FROM supplier_users WHERE is_active=true) + (SELECT COUNT(*) FROM platform_admins WHERE is_active=true) AS active`),
      pool.query(
        `SELECT COALESCE(SUM(CASE WHEN a.account_code='CASH_BANK' THEN jl.debit - jl.credit ELSE 0 END), 0) AS cash_bank,
                COALESCE(SUM(CASE WHEN a.account_code='ESCROW_CASH' THEN jl.debit - jl.credit ELSE 0 END), 0) AS escrow_cash
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_entry_id = je.id
         JOIN accounts a ON a.id = jl.account_id
         WHERE je.approved = true`
      ),
      pool.query(`SELECT COUNT(*)::int AS total,
                         COUNT(*) FILTER (WHERE status IN ('pending_acceptance','accepted','delivery_in_progress','delivered','disputed'))::int AS active,
                         COUNT(*) FILTER (WHERE status='disputed')::int AS disputed
                  FROM orders`),
      pool.query(`SELECT
                    COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE type='AR' AND status IN ('sent','partially_paid')), 0) AS ar_open,
                    COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE type='AR' AND due_date < CURRENT_DATE AND status IN ('sent','partially_paid')), 0) AS ar_overdue,
                    COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE type='AP' AND status IN ('sent','partially_paid')), 0) AS ap_open,
                    COUNT(*) FILTER (WHERE status IN ('sent','partially_paid'))::int AS open_count,
                    COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status IN ('sent','partially_paid'))::int AS overdue_count
                  FROM invoices`),
      pool.query(`SELECT COUNT(*)::int AS total,
                         COUNT(*) FILTER (WHERE is_active=true)::int AS active,
                         COUNT(*) FILTER (WHERE role='system_admin' AND is_active=true)::int AS system_admins,
                         COUNT(*) FILTER (WHERE role='business_admin' AND is_active=true)::int AS business_admins
                  FROM platform_admins`),
      pool.query(`SELECT COUNT(*)::int AS entries,
                         COALESCE(SUM(jl.debit), 0) AS total_debit,
                         COALESCE(SUM(jl.credit), 0) AS total_credit
                  FROM journal_entries je
                  JOIN journal_lines jl ON jl.journal_entry_id = je.id
                  WHERE je.approved = true`),
      pool.query(`SELECT COUNT(*)::int AS total,
                         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS last_24h
                  FROM audit_log`),
    ]);

    const bids = bidsRes.rows[0];
    const tenants = tenantsRes.rows[0];
    const suppliers = suppliersRes.rows[0];
    const users = usersRes.rows[0];
    const cash = cashRes.rows[0];
    const orders = ordersRes.rows[0];
    const invoices = invoicesRes.rows[0];
    const admins = adminsRes.rows[0];
    const journal = journalRes.rows[0];
    const audit = auditRes.rows[0];
    const cashBank = parseFloat(cash.cash_bank || 0);
    const escrowCash = parseFloat(cash.escrow_cash || 0);
    const journalDebit = parseFloat(journal.total_debit || 0);
    const journalCredit = parseFloat(journal.total_credit || 0);

    res.json({
      totalBids: bids.total,
      activeBids: bids.active,
      awardedBids: bids.awarded,
      totalTenants: tenants.total,
      activeTenants: tenants.active,
      totalSuppliers: suppliers.total,
      verifiedSuppliers: suppliers.verified,
      pendingSuppliers: suppliers.pending,
      totalUsers: parseInt(users.total || 0, 10),
      activeUsers: parseInt(users.active || 0, 10),
      totalCashOnPlatform: cashBank + escrowCash,
      cashBank,
      escrowCash,
      orders: {
        total: orders.total,
        active: orders.active,
        disputed: orders.disputed,
      },
      invoices: {
        arOpen: parseFloat(invoices.ar_open || 0),
        arOverdue: parseFloat(invoices.ar_overdue || 0),
        apOpen: parseFloat(invoices.ap_open || 0),
        openCount: parseInt(invoices.open_count || 0, 10),
        overdueCount: parseInt(invoices.overdue_count || 0, 10),
      },
      admins: {
        total: admins.total,
        active: admins.active,
        systemAdmins: admins.system_admins,
        businessAdmins: admins.business_admins,
      },
      ledger: {
        entries: journal.entries,
        totalDebit: journalDebit,
        totalCredit: journalCredit,
        balanced: Math.abs(journalDebit - journalCredit) < 0.005,
      },
      audit: {
        total: audit.total,
        last24h: audit.last_24h,
      },
      systemUptime: os.uptime(),
      memory: {
        rss: process.memoryUsage().rss,
        heapUsed: process.memoryUsage().heapUsed,
        heapTotal: process.memoryUsage().heapTotal
      },
      cpuLoad: os.loadavg(),
      dbStatus: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch system stats' });
  }
});

// ─── Admin CRUD ──────────────────────────────────────────────
router.get('/system/admins', authenticate, requireRole('system_admin'), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, email, full_name, role, is_active, last_login, created_at FROM platform_admins ORDER BY created_at'
  );
  res.json(rows);
});

router.put('/system/admins/:id', authenticate, requireRole('system_admin'), async (req, res) => {
  const { id } = req.params;
  const { email, full_name, role, password, is_active } = req.body;
  if (role !== undefined && !['system_admin', 'business_admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE platform_admins IN EXCLUSIVE MODE');

    const { rows: [existing] } = await client.query('SELECT * FROM platform_admins WHERE id = $1', [id]);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Admin not found' });
    }

    // Immutability checks
    if (existing.email === IMMUTABLE_EMAIL) {
      if (email !== undefined && email !== IMMUTABLE_EMAIL) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Cannot change the immutable admin email.' });
      }
      if (role !== undefined) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Cannot change role of immutable admin.' });
      }
      if (is_active === false) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Cannot deactivate the immutable admin.' });
      }
      // Allow password and name changes only
    }

    const nextRole = role || existing.role;
    const nextActive = is_active !== undefined ? is_active : existing.is_active;
    if (nextRole === 'system_admin' && existing.email !== IMMUTABLE_EMAIL) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'The system admin seat is reserved for the primary administrator.' });
    }

    if (nextActive === true) {
      const { rows: [seat] } = await client.query(
        'SELECT id, email FROM platform_admins WHERE role = $1 AND is_active = true AND id != $2',
        [nextRole, id]
      );
      if (seat) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: `${ADMIN_ROLE_LABELS[nextRole]} already has an active administrator.` });
      }
    }

    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (email !== undefined) { updates.push(`email = $${paramIdx++}`); values.push(email); }
    if (full_name !== undefined) { updates.push(`full_name = $${paramIdx++}`); values.push(full_name); }
    if (role !== undefined) { updates.push(`role = $${paramIdx++}`); values.push(role); }
    if (is_active !== undefined) { updates.push(`is_active = $${paramIdx++}`); values.push(is_active); }
    if (password) {
      const pwErr = validatePassword(password);
      if (pwErr) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: pwErr });
      }
      const hash = await bcrypt.hash(password, 12);
      updates.push(`password_hash = $${paramIdx++}`);
      values.push(hash);
    }
    if (updates.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = now()`);
    values.push(id);
    await client.query(`UPDATE platform_admins SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error updating admin:', e);
    res.status(500).json({ error: 'Failed to update admin: ' + e.message });
  } finally {
    client.release();
  }
});

router.delete('/system/admins/:id', authenticate, requireRole('system_admin'), async (req, res) => {
  const { id } = req.params;
  const { rows: [existing] } = await pool.query('SELECT email FROM platform_admins WHERE id = $1', [id]);
  if (!existing) return res.status(404).json({ error: 'Admin not found' });
  if (existing.email === IMMUTABLE_EMAIL) return res.status(403).json({ error: 'Cannot delete the immutable admin.' });

  await pool.query('UPDATE platform_admins SET is_active = false, updated_at = now() WHERE id = $1', [id]);
  res.json({ success: true });
});

// ─── Server Console ──────────────────────────────────────────
router.post('/system/console', authenticate, requireRole('system_admin'), async (req, res) => {
  const { command } = req.body;
  let output = '';

  try {
    switch (command) {
      case 'uptime':
        output = `Uptime: ${os.uptime()} seconds`;
        break;
      case 'memory':
        output = JSON.stringify(process.memoryUsage(), null, 2);
        break;
      case 'load':
        output = `Load average: ${os.loadavg().join(', ')}`;
        break;
      case 'db status':
        await pool.query('SELECT 1');
        output = 'Database connection OK';
        break;
      case 'active users':
        const { rows: activeSeats } = await pool.query(
          `SELECT role, COUNT(*)::int AS cnt
           FROM platform_admins
           WHERE is_active = true
           GROUP BY role
           ORDER BY role`
        );
        output = `Active admin seats:\n${activeSeats.map(row => `${row.role}: ${row.cnt}`).join('\n') || 'none'}`;
        break;
      case 'free':
        output = `Free memory: ${os.freemem()} bytes / Total: ${os.totalmem()} bytes`;
        break;
      default:
        output = 'Unknown command. Available: uptime, memory, load, db status, active users, free';
    }
    res.json({ output });
  } catch (err) {
    res.status(500).json({ output: `Error: ${err.message}` });
  }
});

module.exports = router;
