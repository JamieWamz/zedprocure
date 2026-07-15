const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const SYSTEM_ADMIN_EMAIL = process.env.SYSTEM_ADMIN_EMAIL || 'system.admin@freshstart.local';
const BUSINESS_ADMIN_EMAIL = process.env.BUSINESS_ADMIN_EMAIL || 'business.admin@freshstart.local';
const SYSTEM_ADMIN_NAME = process.env.SYSTEM_ADMIN_NAME || 'System Administrator';
const BUSINESS_ADMIN_NAME = process.env.BUSINESS_ADMIN_NAME || 'Business Administrator';

// Generates a password that satisfies the platform's validation policy.
function generateStrongPassword() {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const num = '23456789';
  const special = '!@#$%&*?';
  const all = lower + upper + num + special;
  const pick = (set, n) => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join('');
  const raw = pick(lower, 3) + pick(upper, 3) + pick(num, 2) + pick(special, 2) + pick(all, 4);
  return raw.split('').sort(() => Math.random() - 0.5).join('');
}

// Resolves a password: explicit env var wins, otherwise a strong random one is generated
// and recorded so it can be shown to the operator (applies only when the row is created).
function resolvePassword(envVar, log) {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.length >= 10) return fromEnv;
  const generated = generateStrongPassword();
  log.push(`${envVar || '(generated)'}: ${generated}`);
  return generated;
}

async function seed() {
  const client = await pool.connect();
  const generatedLog = [];
  try {
    await client.query('BEGIN');

    // System Admin (immutable). Email/password come from environment or safe placeholders.
    const sysPwd = await bcrypt.hash(resolvePassword('SYSTEM_ADMIN_PASSWORD', generatedLog), 12);
    const { rows: [sysAdmin] } = await client.query('SELECT 1 FROM platform_admins WHERE email=$1', [SYSTEM_ADMIN_EMAIL]);
    if (!sysAdmin) {
      await client.query(
        `INSERT INTO platform_admins (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, 'system_admin')`,
        [SYSTEM_ADMIN_EMAIL, sysPwd, SYSTEM_ADMIN_NAME]
      );
    } else if (process.env.SYSTEM_ADMIN_PASSWORD) {
      // Update password hash on re-run if env var is set
      await client.query(
        `UPDATE platform_admins SET password_hash=$1 WHERE email=$2`,
        [sysPwd, SYSTEM_ADMIN_EMAIL]
      );
    }

    // Business Admin – the sole admin for procurement + accounting operations.
    const bizPwd = await bcrypt.hash(resolvePassword('BUSINESS_ADMIN_PASSWORD', generatedLog), 12);
    const { rows: [bizAdmin] } = await client.query('SELECT 1 FROM platform_admins WHERE email=$1', [BUSINESS_ADMIN_EMAIL]);
    if (!bizAdmin) {
      await client.query(
        `INSERT INTO platform_admins (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, 'business_admin')`,
        [BUSINESS_ADMIN_EMAIL, bizPwd, BUSINESS_ADMIN_NAME]
      );
    } else if (process.env.BUSINESS_ADMIN_PASSWORD) {
      // Update password hash on re-run if env var is set
      await client.query(
        `UPDATE platform_admins SET password_hash=$1 WHERE email=$2`,
        [bizPwd, BUSINESS_ADMIN_EMAIL]
      );
    }

    // Customers and suppliers are intentionally not seeded.
    // They register organically, then Business Admin verifies suppliers.

    // Chart of accounts
    const accounts = [
      ['CASH_BANK', 'Cash at Bank', 'asset'],
      ['ESCROW_CASH', 'Escrow Cash', 'asset'],
      ['ACCOUNTS_RECEIVABLE', 'Accounts Receivable', 'asset'],
      ['ACCOUNTS_PAYABLE', 'Accounts Payable', 'liability'],
      ['PLATFORM_REVENUE', 'Platform Revenue', 'revenue'],
      ['SERVICE_REVENUE', 'Service Revenue', 'revenue'],
      ['SUPPLIER_EXPENSE', 'Supplier Expense', 'expense'],
      ['CUSTOMER_FUNDING', 'Customer Funding Clearing', 'liability'],
      ['SUPPLIER_PAYABLE', 'Supplier Payable', 'liability']
    ];
    for (const [code, name, type] of accounts) {
      await client.query(
        `INSERT INTO accounts (account_code, account_name, account_type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [code, name, type]
      );
    }

    await client.query('COMMIT');
    console.log('Seed complete.');
    if (generatedLog.length) {
      console.log('\n=== GENERATED CREDENTIALS (first run only; store these securely) ===');
      generatedLog.forEach(line => console.log(`  ${line}`));
      console.log('=====================================================================\n');
    } else {
      console.log('All seed accounts already present — no credentials changed.');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
  } finally {
    client.release();
  }
}
seed();
