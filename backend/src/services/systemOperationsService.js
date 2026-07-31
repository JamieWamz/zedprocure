const fs = require('fs');
const path = require('path');
const os = require('os');
const pool = require('../config/db');

const MIGRATIONS_DIR = path.join(__dirname, '../db/migrations');
const SYSTEM_OPERATION_LOCK = 73422109;

const OPERATION_CATALOG = Object.freeze([
  {
    id: 'platform_smoke_test',
    group: 'tests',
    label: 'Platform smoke test',
    description: 'Checks database access, core tables, administrator seats, and migration state.',
    risk: 'safe',
  },
  {
    id: 'finance_integrity_test',
    group: 'tests',
    label: 'Finance integrity test',
    description: 'Checks journal balance, wallet constraints, order totals, and escrow records.',
    risk: 'safe',
  },
  {
    id: 'security_configuration_test',
    group: 'tests',
    label: 'Security configuration test',
    description: 'Checks production secrets, cookie policy, CORS, and privileged account controls without revealing secret values.',
    risk: 'safe',
  },
  {
    id: 'test_notification',
    group: 'developer',
    label: 'Send test notification',
    description: 'Creates a notification for the signed-in system administrator and verifies delivery persistence.',
    risk: 'safe',
  },
  {
    id: 'scheduler_sweep',
    group: 'maintenance',
    label: 'Run scheduler sweep',
    description: 'Runs expired-bid closure and deadline-reminder jobs immediately.',
    risk: 'caution',
    confirmation: 'RUN SCHEDULERS',
  },
  {
    id: 'database_analyze',
    group: 'maintenance',
    label: 'Analyze database',
    description: 'Refreshes PostgreSQL query-planner statistics without changing application records.',
    risk: 'caution',
    confirmation: 'ANALYZE DATABASE',
  },
  {
    id: 'run_migrations',
    group: 'upgrade',
    label: 'Apply pending upgrades',
    description: 'Applies pending forward-only database migrations using PostgreSQL migration locking.',
    risk: 'critical',
    confirmation: 'APPLY UPGRADES',
  },
  {
    id: 'trigger_deploy',
    group: 'deployment',
    label: 'Deploy latest commit',
    description: 'Triggers Render to deploy the latest commit for the configured frontend, backend, or both.',
    risk: 'critical',
    confirmation: 'DEPLOY LATEST',
  },
]);

function normalizeMigrationName(name) {
  return String(name || '').replace(/\.(js|cjs|mjs|ts)$/, '');
}

function operationById(id) {
  return OPERATION_CATALOG.find(operation => operation.id === id);
}

function validateOperationInput(operation, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Operation input must be a JSON object.'), { status: 400 });
  }
  const confirmation = input.confirmation === undefined ? '' : input.confirmation;
  if (typeof confirmation !== 'string' || confirmation.length > 64) {
    throw Object.assign(new Error('Confirmation must be a short string.'), { status: 400 });
  }
  const args = input.args === undefined ? {} : input.args;
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw Object.assign(new Error('Operation options must be a JSON object.'), { status: 400 });
  }

  if (operation.id !== 'trigger_deploy' && Object.keys(args).length > 0) {
    throw Object.assign(new Error('This operation does not accept options.'), { status: 400 });
  }
  if (operation.id === 'trigger_deploy') {
    const unknown = Object.keys(args).filter(key => !['target', 'clearCache'].includes(key));
    if (unknown.length) throw Object.assign(new Error('Unknown deployment option.'), { status: 400 });
    if (args.target !== undefined && !['backend', 'frontend', 'all'].includes(args.target)) {
      throw Object.assign(new Error('Deployment target must be backend, frontend, or all.'), { status: 400 });
    }
    if (args.clearCache !== undefined && typeof args.clearCache !== 'boolean') {
      throw Object.assign(new Error('clearCache must be a boolean.'), { status: 400 });
    }
  }
  return { confirmation, args };
}

function deployConfiguration() {
  return {
    apiKey: Boolean(process.env.RENDER_API_KEY),
    backend: Boolean(process.env.RENDER_BACKEND_SERVICE_ID),
    frontend: Boolean(process.env.RENDER_FRONTEND_SERVICE_ID),
  };
}

function publicCatalog() {
  const deploy = deployConfiguration();
  return OPERATION_CATALOG.map(operation => ({
    ...operation,
    enabled: operation.id !== 'trigger_deploy' || (deploy.apiKey && (deploy.backend || deploy.frontend)),
    disabledReason: operation.id === 'trigger_deploy' && !(deploy.apiKey && (deploy.backend || deploy.frontend))
      ? 'Configure RENDER_API_KEY and at least one Render service ID.'
      : null,
  }));
}

async function getMigrationStatus(db = pool) {
  const local = fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => /\.(js|cjs|mjs|ts)$/.test(file))
    .map(file => normalizeMigrationName(file))
    .sort();
  let applied = [];
  try {
    const { rows } = await db.query('SELECT name, run_on FROM pgmigrations ORDER BY run_on ASC');
    applied = rows.map(row => ({ name: normalizeMigrationName(row.name), runOn: row.run_on }));
  } catch (error) {
    if (error.code !== '42P01') throw error;
  }
  const appliedNames = new Set(applied.map(item => item.name));
  return {
    local,
    applied,
    pending: local.filter(name => !appliedNames.has(name)),
  };
}

async function getOperationHistory(limit = 30, db = pool) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const { rows } = await db.query(
    `SELECT id, actor_id, action, metadata, created_at
       FROM system_logs
      WHERE entity_type = 'system_operation'
      ORDER BY created_at DESC
      LIMIT $1`,
    [safeLimit]
  );
  return rows.map(row => ({
    id: row.id,
    actorId: row.actor_id,
    operation: String(row.action || '').replace(/^system_operation_/, ''),
    ...(row.metadata || {}),
    createdAt: row.created_at,
  }));
}

async function getControlPlane() {
  const migrations = await getMigrationStatus();
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  const { rows: [dbInfo] } = await pool.query(
    `SELECT current_database() AS database_name,
            current_setting('server_version') AS database_version,
            pg_database_size(current_database())::bigint AS database_size`
  );
  return {
    runtime: {
      application: packageJson.name,
      version: packageJson.version,
      node: process.version,
      environment: process.env.NODE_ENV || 'development',
      commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'local',
      service: process.env.RENDER_SERVICE_NAME || 'local',
      region: process.env.RENDER_REGION || null,
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      hostname: os.hostname(),
    },
    database: {
      name: dbInfo.database_name,
      version: dbInfo.database_version,
      sizeBytes: Number(dbInfo.database_size || 0),
      migrations,
    },
    deployment: {
      provider: 'Render',
      branch: process.env.RENDER_GIT_BRANCH || 'main',
      configured: deployConfiguration(),
    },
    operations: publicCatalog(),
    history: await getOperationHistory(),
    generatedAt: new Date().toISOString(),
  };
}

function check(name, passed, detail, warning = false) {
  return { name, status: passed ? 'passed' : warning ? 'warning' : 'failed', detail };
}

function summarizeChecks(checks, successLabel) {
  const failures = checks.filter(item => item.status === 'failed').length;
  const warnings = checks.filter(item => item.status === 'warning').length;
  return {
    status: failures ? 'failed' : warnings ? 'warning' : 'passed',
    summary: failures ? `${failures} check${failures === 1 ? '' : 's'} failed` : warnings ? `${successLabel} with ${warnings} warning${warnings === 1 ? '' : 's'}` : successLabel,
    checks,
  };
}

async function platformSmokeTest() {
  const started = Date.now();
  const { rows: tableRows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [['platform_admins', 'tenants', 'tenant_users', 'suppliers', 'bids', 'orders', 'wallets', 'journal_entries', 'notifications']]
  );
  const requiredTables = 9;
  const { rows: [admins] } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE role = 'system_admin' AND is_active)::int AS system_admins,
            COUNT(*) FILTER (WHERE role = 'business_admin' AND is_active)::int AS business_admins
       FROM platform_admins`
  );
  const migrations = await getMigrationStatus();
  return summarizeChecks([
    check('Database round trip', true, `${Date.now() - started} ms`),
    check('Core database tables', tableRows.length === requiredTables, `${tableRows.length}/${requiredTables} present`),
    check('System administrator seat', admins.system_admins === 1, `${admins.system_admins} active`),
    check('Business administrator seat', admins.business_admins === 1, `${admins.business_admins} active`, true),
    check('Database migrations', migrations.pending.length === 0, migrations.pending.length ? `${migrations.pending.length} pending` : 'Up to date', true),
  ], 'Platform smoke test passed');
}

async function financeIntegrityTest() {
  const [{ rows: [journals] }, { rows: [wallets] }, { rows: [orders] }, { rows: [escrow] }] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM (
      SELECT je.id FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id
      WHERE je.approved = true GROUP BY je.id HAVING ABS(SUM(jl.debit) - SUM(jl.credit)) >= 0.005
    ) unbalanced`),
    pool.query('SELECT COUNT(*)::int AS count FROM wallets WHERE balance < 0'),
    pool.query('SELECT COUNT(*)::int AS count FROM orders WHERE total_amount <= 0'),
    pool.query("SELECT COUNT(*)::int AS count FROM escrow_accounts WHERE status = 'funded' AND amount <= 0"),
  ]);
  return summarizeChecks([
    check('Balanced journal entries', journals.count === 0, `${journals.count} unbalanced`),
    check('Non-negative wallets', wallets.count === 0, `${wallets.count} invalid`),
    check('Positive order totals', orders.count === 0, `${orders.count} invalid`),
    check('Funded escrow amounts', escrow.count === 0, `${escrow.count} invalid`),
  ], 'Finance integrity test passed');
}

async function securityConfigurationTest() {
  const { rows: [admins] } = await pool.query(
    "SELECT COUNT(*) FILTER (WHERE role = 'system_admin' AND is_active)::int AS system_admins FROM platform_admins"
  );
  const isProduction = process.env.NODE_ENV === 'production';
  const jwtLength = String(process.env.JWT_SECRET || '').length;
  const cors = String(process.env.CORS_ORIGINS || '');
  return summarizeChecks([
    check('JWT secret strength', jwtLength >= 32, jwtLength >= 32 ? 'Configured with at least 32 characters' : 'Missing or shorter than 32 characters'),
    check('Explicit CORS allow-list', Boolean(cors) && !cors.includes('*'), cors ? 'Explicit origins configured' : 'No production origin configured'),
    check('Secure production cookies', !isProduction || process.env.COOKIE_SECURE === 'true', isProduction ? `COOKIE_SECURE=${process.env.COOKIE_SECURE || 'unset'}` : 'Not required outside production'),
    check('Single active system admin', admins.system_admins === 1, `${admins.system_admins} active`),
    check('System admin password injection', !isProduction || Boolean(process.env.SYSTEM_ADMIN_PASSWORD), process.env.SYSTEM_ADMIN_PASSWORD ? 'Configured' : 'Not configured', true),
  ], 'Security configuration test passed');
}

async function withOperationLock(callback) {
  const client = await pool.connect();
  let locked = false;
  try {
    const { rows: [result] } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [SYSTEM_OPERATION_LOCK]);
    locked = result.locked;
    if (!locked) throw Object.assign(new Error('Another maintenance operation is already running.'), { status: 409 });
    return await callback(client);
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [SYSTEM_OPERATION_LOCK]).catch(() => {});
    client.release();
  }
}

async function triggerRenderDeploy(args = {}) {
  const config = deployConfiguration();
  if (!config.apiKey || (!config.backend && !config.frontend)) {
    throw Object.assign(new Error('Render deployment credentials are not configured.'), { status: 503 });
  }
  const target = ['backend', 'frontend', 'all'].includes(args.target) ? args.target : 'all';
  const services = [];
  if (target !== 'frontend' && process.env.RENDER_BACKEND_SERVICE_ID) services.push({ target: 'backend', id: process.env.RENDER_BACKEND_SERVICE_ID });
  if (target !== 'backend' && process.env.RENDER_FRONTEND_SERVICE_ID) services.push({ target: 'frontend', id: process.env.RENDER_FRONTEND_SERVICE_ID });
  if (!services.length) throw Object.assign(new Error(`Render ${target} service ID is not configured.`), { status: 400 });

  const results = [];
  for (const service of services) {
    const response = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(service.id)}/deploys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearCache: args.clearCache ? 'clear' : 'do_not_clear' }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(`Render rejected the ${service.target} deploy (${response.status}).`), { status: 502 });
    results.push({ target: service.target, deployId: body.id || null, status: body.status || 'queued' });
  }
  return { status: 'passed', summary: `Queued ${results.length} Render deployment${results.length === 1 ? '' : 's'}`, deployments: results };
}

async function executeOperation(operationId, input = {}) {
  const operation = operationById(operationId);
  if (!operation) throw Object.assign(new Error('Unknown system operation.'), { status: 404 });
  const { actor, confirmation, args } = { ...input, ...validateOperationInput(operation, input) };
  if (!actor?.id) throw Object.assign(new Error('Authenticated operation actor is required.'), { status: 401 });
  if (operation.confirmation && confirmation !== operation.confirmation) {
    throw Object.assign(new Error(`Type “${operation.confirmation}” to confirm this operation.`), { status: 400 });
  }

  const startedAt = new Date();
  const start = Date.now();
  let result;
  try {
    switch (operationId) {
      case 'platform_smoke_test': result = await platformSmokeTest(); break;
      case 'finance_integrity_test': result = await financeIntegrityTest(); break;
      case 'security_configuration_test': result = await securityConfigurationTest(); break;
      case 'test_notification': {
        const { rows: [notification] } = await pool.query(
          `INSERT INTO notifications (user_id, user_type, type, title, message, link, metadata)
           VALUES ($1, 'platform_admin', 'system_test', 'System notification test', 'Notification delivery is working.', '/system-health?tab=operations', $2)
           RETURNING id`,
          [actor.id, JSON.stringify({ operation: operationId })]
        );
        result = { status: 'passed', summary: 'Test notification created', notificationId: notification.id };
        break;
      }
      case 'scheduler_sweep':
        result = await withOperationLock(async () => {
          await require('./bidScheduler').closeExpiredBids();
          await require('./notificationScheduler').sendDeadlineReminders();
          return { status: 'passed', summary: 'Scheduler sweep completed' };
        });
        break;
      case 'database_analyze':
        result = await withOperationLock(async client => {
          await client.query('ANALYZE');
          return { status: 'passed', summary: 'Database planner statistics refreshed' };
        });
        break;
      case 'run_migrations':
        result = await withOperationLock(async () => {
          if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
          const { runner } = require('node-pg-migrate');
          const logs = [];
          const migrations = await runner({
            databaseUrl: process.env.DATABASE_URL,
            dir: MIGRATIONS_DIR,
            direction: 'up',
            migrationsTable: 'pgmigrations',
            count: Infinity,
            singleTransaction: true,
            log: message => logs.push(String(message)),
          });
          return {
            status: 'passed',
            summary: migrations.length ? `Applied ${migrations.length} migration${migrations.length === 1 ? '' : 's'}` : 'Database already up to date',
            migrations: migrations.map(migration => migration.name),
            logs: logs.slice(-20),
          };
        });
        break;
      case 'trigger_deploy': result = await triggerRenderDeploy(args); break;
      default: throw Object.assign(new Error('Operation is not implemented.'), { status: 501 });
    }

    const durationMs = Date.now() - start;
    await pool.query(
      `INSERT INTO system_logs (actor_id, actor_type, action, entity_type, metadata)
       VALUES ($1, 'platform_admin', $2, 'system_operation', $3)`,
      [actor.id, `system_operation_${operationId}`, JSON.stringify({ status: result.status, summary: result.summary, durationMs, startedAt: startedAt.toISOString() })]
    );
    return { operation: operationId, startedAt, durationMs, ...result };
  } catch (error) {
    const durationMs = Date.now() - start;
    await pool.query(
      `INSERT INTO system_logs (actor_id, actor_type, action, entity_type, metadata)
       VALUES ($1, 'platform_admin', $2, 'system_operation', $3)`,
      [actor.id, `system_operation_${operationId}`, JSON.stringify({ status: 'failed', summary: error.message, durationMs, startedAt: startedAt.toISOString() })]
    ).catch(() => {});
    throw error;
  }
}

module.exports = {
  OPERATION_CATALOG,
  executeOperation,
  getControlPlane,
  getMigrationStatus,
  getOperationHistory,
  normalizeMigrationName,
  publicCatalog,
  summarizeChecks,
  validateOperationInput,
};
