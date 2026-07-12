const express = require('express');
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const os = require('os');
const router = express.Router();

const IMMUTABLE_EMAIL = 'wamuyuwamundia@gmail.com';

// ─── System Stats ───────────────────────────────────────────
router.get('/system/stats', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
    const { rows: [bids] } = await pool.query('SELECT COUNT(*)::int AS total FROM bids');
    const { rows: [tenants] } = await pool.query('SELECT COUNT(*)::int AS total FROM tenants');
    const { rows: [suppliers] } = await pool.query('SELECT COUNT(*)::int AS total FROM suppliers');
    const { rows: [users] } = await pool.query(
      'SELECT (SELECT COUNT(*) FROM tenant_users) + (SELECT COUNT(*) FROM supplier_users) + (SELECT COUNT(*) FROM platform_admins) AS total'
    );
    const { rows: [cash] } = await pool.query(
      `SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) AS balance
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
       WHERE a.account_code IN ('CASH_BANK','ESCROW_CASH')`
    );

    res.json({
      totalBids: bids.total,
      totalTenants: tenants.total,
      totalSuppliers: suppliers.total,
      totalUsers: users.total,
      totalCashOnPlatform: parseFloat(cash.balance),
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

    // If trying to activate, enforce max 3 additional active admins (excluding immutable)
    if (is_active === true) {
      const { rows: [count] } = await client.query(
        'SELECT COUNT(*)::int AS cnt FROM platform_admins WHERE is_active = true AND id != $1 AND email != $2',
        [id, IMMUTABLE_EMAIL]
      );
      if (count.cnt >= 3) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Maximum 3 additional active administrators allowed.' });
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
      case 'db version':
        const { rows: [version] } = await pool.query('SELECT version()');
        output = version.version;
        break;
      case 'active users':
        const { rows: [active] } = await pool.query(
          'SELECT COUNT(*)::int AS cnt FROM platform_admins WHERE is_active = true AND email != $1',
          [IMMUTABLE_EMAIL]
        );
        output = `Additional active admins: ${active.cnt} (immutable admin excluded)`;
        break;
      case 'free':
        output = `Free memory: ${os.freemem()} bytes / Total: ${os.totalmem()} bytes`;
        break;
      default:
        output = 'Unknown command. Available: uptime, memory, load, db status, db version, active users, free';
    }
    res.json({ output });
  } catch (err) {
    res.status(500).json({ output: `Error: ${err.message}` });
  }
});

module.exports = router;
