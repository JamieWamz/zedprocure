const express = require('express');
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { validatePassword } = require('../utils/passwordValidation');
const { cleanText, requireUuid } = require('../utils/requestValidation');
const {
  assertIdentityEmailAvailable,
  normalizeIdentityEmail,
  requireValidIdentityEmail,
} = require('../services/identityEmailGuard');
const os = require('os');
const rateLimit = require('express-rate-limit');
const {
  executeOperation,
  getControlPlane,
  getOperationHistory,
} = require('../services/systemOperationsService');
const router = express.Router();

const operationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many system operations. Wait one minute and try again.' },
});

const IMMUTABLE_EMAIL = 'wamuyuwamundia@gmail.com';
const ADMIN_ROLE_LABELS = {
  system_admin: 'System Admin',
  business_admin: 'Business Admin',
};
const USER_TYPE_CONFIG = Object.freeze({
  platform_admin: Object.freeze({
    table: 'platform_admins',
    detailQuery: `
      SELECT pa.id, 'platform_admin'::text AS user_type, pa.role, pa.email,
             pa.full_name, pa.is_active,
             NULL::uuid AS organization_id, NULL::text AS organization_name,
             NULL::uuid AS company_id, NULL::text AS company_name
      FROM platform_admins pa
      WHERE pa.id = $1`,
  }),
  tenant_user: Object.freeze({
    table: 'tenant_users',
    detailQuery: `
      SELECT tu.id, 'tenant_user'::text AS user_type, tu.role, tu.email,
             tu.full_name, tu.is_active,
             t.id AS organization_id, t.name AS organization_name,
             NULL::uuid AS company_id, NULL::text AS company_name
      FROM tenant_users tu
      JOIN tenants t ON t.id = tu.tenant_id
      WHERE tu.id = $1`,
  }),
  supplier_user: Object.freeze({
    table: 'supplier_users',
    detailQuery: `
      SELECT su.id, 'supplier_user'::text AS user_type, su.role, su.email,
             su.full_name, su.is_active,
             NULL::uuid AS organization_id, NULL::text AS organization_name,
             s.id AS company_id, s.company_name
      FROM supplier_users su
      JOIN suppliers s ON s.id = su.supplier_id
      WHERE su.id = $1`,
  }),
});

const SYSTEM_USERS_QUERY = `
  SELECT users.*
  FROM (
    SELECT pa.id, 'platform_admin'::text AS user_type, pa.role, pa.email,
           pa.full_name, pa.is_active,
           NULL::uuid AS organization_id, NULL::text AS organization_name,
           NULL::uuid AS company_id, NULL::text AS company_name
    FROM platform_admins pa
    UNION ALL
    SELECT tu.id, 'tenant_user'::text AS user_type, tu.role, tu.email,
           tu.full_name, tu.is_active,
           t.id AS organization_id, t.name AS organization_name,
           NULL::uuid AS company_id, NULL::text AS company_name
    FROM tenant_users tu
    JOIN tenants t ON t.id = tu.tenant_id
    UNION ALL
    SELECT su.id, 'supplier_user'::text AS user_type, su.role, su.email,
           su.full_name, su.is_active,
           NULL::uuid AS organization_id, NULL::text AS organization_name,
           s.id AS company_id, s.company_name
    FROM supplier_users su
    JOIN suppliers s ON s.id = su.supplier_id
  ) users
  ORDER BY users.user_type, users.full_name, users.email`;

function serializeSystemUser(row, actorId = null) {
  const normalizedEmail = normalizeIdentityEmail(row.email);
  const isPlatformAdmin = row.user_type === 'platform_admin';
  const protectedAccount = isPlatformAdmin && normalizedEmail === IMMUTABLE_EMAIL;
  const isCurrentAdmin = isPlatformAdmin
    && actorId
    && String(row.id).toLowerCase() === String(actorId).toLowerCase();
  return {
    id: row.id,
    user_type: row.user_type,
    role: row.role,
    email: normalizedEmail,
    full_name: row.full_name,
    is_active: row.is_active,
    protected: protectedAccount,
    can_edit_status: !protectedAccount && !isCurrentAdmin,
    organization: row.organization_id
      ? { id: row.organization_id, name: row.organization_name }
      : null,
    company: row.company_id
      ? { id: row.company_id, name: row.company_name }
      : null,
  };
}

function validateUserUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('A JSON object is required');
  }

  const allowedFields = new Set(['full_name', 'email', 'is_active']);
  const fields = Object.keys(body);
  const unknownField = fields.find(field => !allowedFields.has(field));
  if (unknownField) throw new Error(`Unknown field: ${unknownField}`);
  if (fields.length === 0) throw new Error('At least one field is required');

  const update = {};
  if (Object.prototype.hasOwnProperty.call(body, 'full_name')) {
    update.full_name = cleanText(body.full_name, { required: true, maxLength: 150 });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    update.email = requireValidIdentityEmail(body.email);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'is_active')) {
    if (typeof body.is_active !== 'boolean') throw new Error('is_active must be a boolean');
    update.is_active = body.is_active;
  }
  return update;
}

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
  } catch {
    res.status(500).json({ error: 'Failed to fetch system stats' });
  }
});

// ─── Unified User Maintenance ───────────────────────────────
router.get('/system/users', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(SYSTEM_USERS_QUERY);
    const actorId = req.user.id || req.user.user_id;
    return res.json({ users: rows.map(row => serializeSystemUser(row, actorId)) });
  } catch (error) {
    console.error('Error loading system users:', error);
    return res.status(500).json({ error: 'Failed to load users' });
  }
});

router.patch('/system/users/:userType/:id', authenticate, requireRole('system_admin'), async (req, res) => {
  const { userType } = req.params;
  const config = USER_TYPE_CONFIG[userType];
  if (!config) {
    return res.status(400).json({
      error: `userType must be one of: ${Object.keys(USER_TYPE_CONFIG).join(', ')}`,
    });
  }

  let userId;
  let update;
  try {
    userId = requireUuid(req.params.id, 'id');
    update = validateUserUpdate(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    if (userType === 'platform_admin') {
      await client.query('LOCK TABLE platform_admins IN EXCLUSIVE MODE');
    }

    const { rows: [existing] } = await client.query(
      `SELECT id, email, full_name, role, is_active
       FROM ${config.table}
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );
    if (!existing) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'User not found' });
    }

    const existingEmail = normalizeIdentityEmail(existing.email);
    const actualUpdate = {};
    if (update.full_name !== undefined && update.full_name !== existing.full_name) {
      actualUpdate.full_name = update.full_name;
    }
    if (update.email !== undefined && update.email !== existingEmail) {
      actualUpdate.email = update.email;
    }
    if (update.is_active !== undefined && update.is_active !== existing.is_active) {
      actualUpdate.is_active = update.is_active;
    }

    if (userType === 'platform_admin') {
      const isPrimarySystemAdmin = existingEmail === IMMUTABLE_EMAIL;
      if (isPrimarySystemAdmin && actualUpdate.email !== undefined) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(403).json({ error: 'Cannot change the primary system administrator email' });
      }
      if (isPrimarySystemAdmin && actualUpdate.is_active === false) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(403).json({ error: 'Cannot deactivate the primary system administrator' });
      }

      const actorId = String(req.user.id || req.user.user_id || '').toLowerCase();
      if (actorId === userId.toLowerCase() && actualUpdate.is_active === false) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(403).json({ error: 'You cannot deactivate your own account' });
      }

      if (actualUpdate.is_active === true) {
        const { rows: [activeSeat] } = await client.query(
          `SELECT id
           FROM platform_admins
           WHERE role = $1 AND is_active = true AND id <> $2
           LIMIT 1`,
          [existing.role, userId]
        );
        if (activeSeat) {
          await client.query('ROLLBACK');
          transactionStarted = false;
          return res.status(403).json({
            error: `${ADMIN_ROLE_LABELS[existing.role]} already has an active administrator.`,
          });
        }
      }
    }

    if (actualUpdate.email !== undefined || actualUpdate.is_active === true) {
      await assertIdentityEmailAvailable(
        client,
        actualUpdate.email || existingEmail,
        { userType, id: userId, lockEmails: [existingEmail] }
      );
    }

    const changedFields = Object.keys(actualUpdate);
    if (changedFields.length === 0) {
      const { rows: [unchangedUser] } = await client.query(config.detailQuery, [userId]);
      const serializedUser = serializeSystemUser(
        unchangedUser,
        req.user.id || req.user.user_id
      );
      await client.query('COMMIT');
      transactionStarted = false;
      return res.json({
        message: 'No changes were necessary',
        user: serializedUser,
      });
    }

    const assignments = [];
    const values = [];
    for (const field of ['full_name', 'email', 'is_active']) {
      if (actualUpdate[field] !== undefined) {
        values.push(actualUpdate[field]);
        assignments.push(`${field} = $${values.length}`);
      }
    }
    if (userType === 'platform_admin') assignments.push('updated_at = now()');
    values.push(userId);
    await client.query(
      `UPDATE ${config.table}
       SET ${assignments.join(', ')}
       WHERE id = $${values.length}`,
      values
    );

    await client.query(
      `INSERT INTO audit_log
         (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1, $2, $3, 'system_user_updated', $4, $5, $6)`,
      [
        req.user.id || req.user.user_id,
        req.user.user_type || 'platform_admin',
        req.user.email || null,
        userType,
        userId,
        JSON.stringify({
          changed_fields: changedFields,
          email_changed: actualUpdate.email !== undefined,
          status_changed: actualUpdate.is_active !== undefined,
        }),
      ]
    );

    const { rows: [updatedUser] } = await client.query(config.detailQuery, [userId]);
    const serializedUser = serializeSystemUser(updatedUser, req.user.id || req.user.user_id);
    await client.query('COMMIT');
    transactionStarted = false;
    return res.json({
      message: 'User updated successfully',
      user: serializedUser,
    });
  } catch (error) {
    if (transactionStarted && client) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be unavailable */ }
    }
    if (error.statusCode === 409) {
      return res.status(409).json({ error: error.message });
    }
    if (error.code === '23505') {
      const isSeatConflict = error.constraint === 'platform_admins_one_active_role_idx';
      return res.status(isSeatConflict ? 403 : 409).json({
        error: isSeatConflict
          ? 'That platform administrator role already has an active account'
          : 'An account with this email already exists',
      });
    }
    console.error('Error updating system user:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  } finally {
    client?.release();
  }
});

// ─── Operations Control Plane ───────────────────────────────
router.get('/system/control-plane', authenticate, requireRole('system_admin'), async (_req, res) => {
  try {
    res.json(await getControlPlane());
  } catch (error) {
    console.error('Error loading system control plane:', error);
    res.status(500).json({ error: 'Failed to load operations control plane.' });
  }
});

router.get('/system/operations/history', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
    res.json(await getOperationHistory(req.query.limit));
  } catch {
    res.status(500).json({ error: 'Failed to load operation history.' });
  }
});

router.post('/system/operations/:operationId', authenticate, requireRole('system_admin'), operationLimiter, async (req, res) => {
  try {
    const result = await executeOperation(req.params.operationId, {
      actor: { id: req.user.id || req.user.user_id, email: req.user.email },
      confirmation: req.body?.confirmation,
      args: req.body?.args,
    });
    res.json(result);
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(`System operation ${req.params.operationId} failed:`, error);
    res.status(status).json({
      error: status >= 500 ? 'System operation failed. Review the operation history and server logs.' : error.message,
    });
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
  let id;
  try {
    id = requireUuid(req.params.id, 'id');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const body = req.body || {};
  const { role, password } = body;
  let email;
  let fullName;
  let isActive;
  try {
    if (Object.prototype.hasOwnProperty.call(body, 'email')) {
      email = requireValidIdentityEmail(body.email);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'full_name')) {
      fullName = cleanText(body.full_name, { required: true, maxLength: 150 });
    }
    if (Object.prototype.hasOwnProperty.call(body, 'is_active')) {
      if (typeof body.is_active !== 'boolean') throw new Error('is_active must be a boolean');
      isActive = body.is_active;
    }
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (role !== undefined && !['system_admin', 'business_admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (password) {
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });
  }

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query('LOCK TABLE platform_admins IN EXCLUSIVE MODE');

    const { rows: [existing] } = await client.query(
      'SELECT * FROM platform_admins WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!existing) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'Admin not found' });
    }

    const existingEmail = normalizeIdentityEmail(existing.email);
    const actualUpdate = {};
    if (email !== undefined && email !== existingEmail) actualUpdate.email = email;
    if (fullName !== undefined && fullName !== existing.full_name) actualUpdate.full_name = fullName;
    if (role !== undefined && role !== existing.role) actualUpdate.role = role;
    if (isActive !== undefined && isActive !== existing.is_active) actualUpdate.is_active = isActive;
    if (password && !(await bcrypt.compare(password, existing.password_hash))) {
      actualUpdate.password_hash = await bcrypt.hash(password, 12);
    }

    const isPrimarySystemAdmin = existingEmail === IMMUTABLE_EMAIL;
    if (isPrimarySystemAdmin) {
      if (actualUpdate.email !== undefined) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(403).json({ error: 'Cannot change the immutable admin email.' });
      }
      if (actualUpdate.role !== undefined) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(403).json({ error: 'Cannot change role of immutable admin.' });
      }
      if (actualUpdate.is_active === false) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(403).json({ error: 'Cannot deactivate the immutable admin.' });
      }
    }

    const actorId = String(req.user.id || req.user.user_id || '').toLowerCase();
    if (actorId === id.toLowerCase() && actualUpdate.is_active === false) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ error: 'You cannot deactivate your own account' });
    }

    const nextRole = actualUpdate.role || existing.role;
    const nextActive = actualUpdate.is_active !== undefined
      ? actualUpdate.is_active
      : existing.is_active;
    if (nextRole === 'system_admin' && !isPrimarySystemAdmin) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ error: 'The system admin seat is reserved for the primary administrator.' });
    }

    if (nextActive === true && (actualUpdate.role !== undefined || actualUpdate.is_active === true)) {
      const { rows: [seat] } = await client.query(
        'SELECT id, email FROM platform_admins WHERE role = $1 AND is_active = true AND id != $2',
        [nextRole, id]
      );
      if (seat) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(403).json({ error: `${ADMIN_ROLE_LABELS[nextRole]} already has an active administrator.` });
      }
    }

    if (actualUpdate.email !== undefined || actualUpdate.is_active === true) {
      await assertIdentityEmailAvailable(
        client,
        actualUpdate.email || existingEmail,
        { userType: 'platform_admin', id, lockEmails: [existingEmail] }
      );
    }

    const changedFields = Object.keys(actualUpdate).map(field => (
      field === 'password_hash' ? 'password' : field
    ));
    if (changedFields.length === 0) {
      await client.query('COMMIT');
      transactionStarted = false;
      return res.json({ success: true, no_changes: true });
    }

    const updates = [];
    const values = [];
    for (const field of ['email', 'full_name', 'role', 'is_active', 'password_hash']) {
      if (actualUpdate[field] !== undefined) {
        values.push(actualUpdate[field]);
        updates.push(`${field} = $${values.length}`);
      }
    }
    updates.push('updated_at = now()');
    values.push(id);
    await client.query(
      `UPDATE platform_admins SET ${updates.join(', ')} WHERE id = $${values.length}`,
      values
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1, $2, $3, 'platform_admin_updated', 'platform_admin', $4, $5)`,
      [
        req.user.id || req.user.user_id,
        req.user.user_type || 'platform_admin',
        req.user.email || null,
        id,
        JSON.stringify({
          changed_fields: changedFields,
          email_changed: actualUpdate.email !== undefined,
          status_changed: actualUpdate.is_active !== undefined,
        }),
      ]
    );
    await client.query('COMMIT');
    transactionStarted = false;
    res.json({ success: true });
  } catch (e) {
    if (transactionStarted && client) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be unavailable */ }
    }
    if (e.statusCode === 409) return res.status(409).json({ error: e.message });
    if (e.code === '23505') {
      const isSeatConflict = e.constraint === 'platform_admins_one_active_role_idx';
      return res.status(isSeatConflict ? 403 : 409).json({
        error: isSeatConflict
          ? 'That platform administrator role already has an active account.'
          : 'An account with this email already exists',
      });
    }
    console.error('Error updating admin:', e);
    res.status(500).json({ error: 'Failed to update admin' });
  } finally {
    client?.release();
  }
});

router.delete('/system/admins/:id', authenticate, requireRole('system_admin'), async (req, res) => {
  let id;
  try {
    id = requireUuid(req.params.id, 'id');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query('LOCK TABLE platform_admins IN EXCLUSIVE MODE');
    const { rows: [existing] } = await client.query(
      'SELECT id, email, role, is_active FROM platform_admins WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!existing) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'Admin not found' });
    }
    if (normalizeIdentityEmail(existing.email) === IMMUTABLE_EMAIL) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ error: 'Cannot delete the immutable admin.' });
    }
    const actorId = String(req.user.id || req.user.user_id || '').toLowerCase();
    if (actorId === id.toLowerCase()) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ error: 'You cannot deactivate your own account' });
    }
    if (!existing.is_active) {
      await client.query('COMMIT');
      transactionStarted = false;
      return res.json({ success: true, no_changes: true });
    }

    await client.query(
      'UPDATE platform_admins SET is_active = false, updated_at = now() WHERE id = $1',
      [id]
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1, $2, $3, 'platform_admin_deactivated', 'platform_admin', $4, $5)`,
      [
        req.user.id || req.user.user_id,
        req.user.user_type || 'platform_admin',
        req.user.email || null,
        id,
        JSON.stringify({ changed_fields: ['is_active'], status_changed: true }),
      ]
    );
    await client.query('COMMIT');
    transactionStarted = false;
    return res.json({ success: true });
  } catch (error) {
    if (transactionStarted && client) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be unavailable */ }
    }
    console.error('Error deactivating admin:', error);
    return res.status(500).json({ error: 'Failed to deactivate admin' });
  } finally {
    client?.release();
  }
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
        const { rows: versionRows } = await pool.query('SELECT version()');
        output = versionRows[0].version;
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
        output = 'Unknown command. Available: uptime, memory, load, db status, db version, active users, free';
    }
    res.json({ output });
  } catch (err) {
    res.status(500).json({ output: `Error: ${err.message}` });
  }
});

module.exports = router;
