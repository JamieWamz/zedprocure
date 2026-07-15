const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

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

    // System Admin – Mundia Wamuyuwa (immutable). Email is fixed; password from env or generated.
    const { rows: [sysAdmin] } = await client.query('SELECT 1 FROM platform_admins WHERE email=$1', ['wamuyuwamundia@gmail.com']);
    if (!sysAdmin) {
      const sysPwd = await bcrypt.hash(resolvePassword('SYSTEM_ADMIN_PASSWORD', generatedLog), 12);
      await client.query(
        `INSERT INTO platform_admins (email, password_hash, full_name, role)
         VALUES ('wamuyuwamundia@gmail.com', $1, 'Mundia J Wamuyuwa', 'system_admin')`,
        [sysPwd]
      );
    }

    // Business Admin – the sole admin for procurement + platform
    const { rows: [bizAdmin] } = await client.query('SELECT 1 FROM platform_admins WHERE email=$1', ['brightilunga6@gmail.com']);
    if (!bizAdmin) {
      const bizPwd = await bcrypt.hash(resolvePassword('BUSINESS_ADMIN_PASSWORD', generatedLog), 12);
      await client.query(
        `INSERT INTO platform_admins (email, password_hash, full_name, role)
         VALUES ('brightilunga6@gmail.com', $1, 'Bright Ilunga', 'business_admin')`,
        [bizPwd]
      );
    }

    // Tenant (Ministry of Works) – the default procuring entity
    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenants (id, name, registration_number)
       VALUES ($1, 'Ministry of Works and Supply', 'MW/001')
       ON CONFLICT (registration_number) DO NOTHING
       RETURNING id`,
      [uuidv4()]
    );
    const tenantId = tenant
      ? tenant.id
      : (await client.query('SELECT id FROM tenants WHERE registration_number = $1', ['MW/001'])).rows[0].id;

    // Tenant admin
    const { rows: [existingTenantAdmin] } = await client.query(
      'SELECT 1 FROM tenant_users WHERE tenant_id=$1 AND email=$2', [tenantId, 'tenantadmin@works.gov.zm']
    );
    if (!existingTenantAdmin) {
      const pwd = await bcrypt.hash(resolvePassword('TENANT_ADMIN_PASSWORD', generatedLog), 12);
      await client.query(
        `INSERT INTO tenant_users (id, tenant_id, email, password_hash, full_name, role)
         VALUES ($1, $2, 'tenantadmin@works.gov.zm', $3, 'Tenant Admin', 'tenant_admin')`,
        [uuidv4(), tenantId, pwd]
      );
    }

    // Customer
    const { rows: [existingCustomer] } = await client.query(
      'SELECT 1 FROM tenant_users WHERE tenant_id=$1 AND email=$2', [tenantId, 'customer@works.gov.zm']
    );
    if (!existingCustomer) {
      const pwd = await bcrypt.hash(resolvePassword('CUSTOMER_PASSWORD', generatedLog), 12);
      await client.query(
        `INSERT INTO tenant_users (id, tenant_id, email, password_hash, full_name, role)
         VALUES ($1, $2, 'customer@works.gov.zm', $3, 'John Customer', 'customer')`,
        [uuidv4(), tenantId, pwd]
      );
    }

    // Verified suppliers (3 for competitive bidding)
    const suppliers = [
      { company: 'Zambia Builders Ltd', reg: 'ZB/2023', email: 'supplier1@builders.zm', name: 'Supplier One' },
      { company: 'Lusaka Engineering Co.', reg: 'LE/2022', email: 'supplier2@engineering.zm', name: 'Supplier Two' },
      { company: 'Copperbelt Traders', reg: 'CT/2023', email: 'supplier3@traders.zm', name: 'Supplier Three' },
    ];

    for (const s of suppliers) {
      const { rows: [existingSupplier] } = await client.query('SELECT 1 FROM suppliers WHERE registration_number=$1', [s.reg]);
      if (existingSupplier) continue;
      const { rows: [supplier] } = await client.query(
        `INSERT INTO suppliers (id, company_name, registration_number, verification_status, is_active)
         VALUES ($1, $2, $3, 'verified', true)
         RETURNING id`,
        [uuidv4(), s.company, s.reg]
      );
      const pwd = await bcrypt.hash(resolvePassword(`SUPPLIER_PASSWORD_${s.reg}`, generatedLog), 12);
      await client.query(
        `INSERT INTO supplier_users (id, supplier_id, email, password_hash, full_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), supplier.id, s.email, pwd, s.name]
      );
    }

    // Chart of accounts
    const accounts = [
      ['CASH_BANK', 'Cash at Bank', 'asset'],
      ['ESCROW_CASH', 'Escrow Cash', 'asset'],
      ['PLATFORM_REVENUE', 'Platform Revenue', 'revenue'],
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
