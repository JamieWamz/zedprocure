const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // System Admin – Mundia Wamuyuwa (immutable)
    const sysPwd = await bcrypt.hash('wamu@2003!', 12);
    await client.query(
      `INSERT INTO platform_admins (email, password_hash, full_name, role)
       VALUES ('wamuyuwamundia@gmail.com', $1, 'Mundia J Wamuyuwa', 'system_admin')
       ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           role = EXCLUDED.role,
           is_active = true,
           updated_at = now()`,
      [sysPwd]
    );

    // Business Admin – the sole admin for procurement + platform
    const bizPwd = await bcrypt.hash('Test@123', 12);
    await client.query(
      `INSERT INTO platform_admins (email, password_hash, full_name, role)
       VALUES ('brightilunga6@gmail.com', $1, 'Bright Ilunga', 'business_admin')
       ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           role = EXCLUDED.role,
           is_active = true,
           updated_at = now()`,
      [bizPwd]
    );

    // Tenant (Ministry of Works) – the default procuring entity
    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenants (id, name, registration_number)
       VALUES ($1, 'Ministry of Works and Supply', 'MW/001')
       ON CONFLICT (registration_number) DO UPDATE
       SET name = EXCLUDED.name,
           is_active = true
       RETURNING id`,
      [uuidv4()]
    );
    const tenantId = tenant.id;

    // Tenant admin
    await client.query(
      `INSERT INTO tenant_users (id, tenant_id, email, password_hash, full_name, role)
       VALUES ($1, $2, 'tenantadmin@works.gov.zm', $3, 'Tenant Admin', 'tenant_admin')
       ON CONFLICT (tenant_id, email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           role = EXCLUDED.role,
           is_active = true`,
      [uuidv4(), tenantId, await bcrypt.hash('Test@123', 12)]
    );

    // Customer
    await client.query(
      `INSERT INTO tenant_users (id, tenant_id, email, password_hash, full_name, role)
       VALUES ($1, $2, 'customer@works.gov.zm', $3, 'John Customer', 'customer')
       ON CONFLICT (tenant_id, email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           role = EXCLUDED.role,
           is_active = true`,
      [uuidv4(), tenantId, await bcrypt.hash('Test@123', 12)]
    );

    // Verified suppliers (3 for competitive bidding)
    const { rows: [supplierOne] } = await client.query(
      `INSERT INTO suppliers (id, company_name, registration_number, verification_status, is_active)
       VALUES ($1, 'Zambia Builders Ltd', 'ZB/2023', 'verified', true)
       ON CONFLICT (registration_number) DO UPDATE
       SET company_name = EXCLUDED.company_name,
           verification_status = 'verified',
           is_active = true
       RETURNING id`,
      [uuidv4()]
    );
    const supplier1 = supplierOne.id;
    await client.query(
      `INSERT INTO supplier_users (id, supplier_id, email, password_hash, full_name)
       VALUES ($1, $2, 'supplier1@builders.zm', $3, 'Supplier One')
       ON CONFLICT (email) DO UPDATE
       SET supplier_id = EXCLUDED.supplier_id,
           password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           is_active = true`,
      [uuidv4(), supplier1, await bcrypt.hash('Test@123', 12)]
    );

    const { rows: [supplierTwo] } = await client.query(
      `INSERT INTO suppliers (id, company_name, registration_number, verification_status, is_active)
       VALUES ($1, 'Lusaka Engineering Co.', 'LE/2022', 'verified', true)
       ON CONFLICT (registration_number) DO UPDATE
       SET company_name = EXCLUDED.company_name,
           verification_status = 'verified',
           is_active = true
       RETURNING id`,
      [uuidv4()]
    );
    const supplier2 = supplierTwo.id;
    await client.query(
      `INSERT INTO supplier_users (id, supplier_id, email, password_hash, full_name)
       VALUES ($1, $2, 'supplier2@engineering.zm', $3, 'Supplier Two')
       ON CONFLICT (email) DO UPDATE
       SET supplier_id = EXCLUDED.supplier_id,
           password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           is_active = true`,
      [uuidv4(), supplier2, await bcrypt.hash('Test@123', 12)]
    );

    const { rows: [supplierThree] } = await client.query(
      `INSERT INTO suppliers (id, company_name, registration_number, verification_status, is_active)
       VALUES ($1, 'Copperbelt Traders', 'CT/2023', 'verified', true)
       ON CONFLICT (registration_number) DO UPDATE
       SET company_name = EXCLUDED.company_name,
           verification_status = 'verified',
           is_active = true
       RETURNING id`,
      [uuidv4()]
    );
    const supplier3 = supplierThree.id;
    await client.query(
      `INSERT INTO supplier_users (id, supplier_id, email, password_hash, full_name)
       VALUES ($1, $2, 'supplier3@traders.zm', $3, 'Supplier Three')
       ON CONFLICT (email) DO UPDATE
       SET supplier_id = EXCLUDED.supplier_id,
           password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           is_active = true`,
      [uuidv4(), supplier3, await bcrypt.hash('Test@123', 12)]
    );

    // Chart of accounts
    const accounts = [
      ['CASH_BANK','Cash at Bank','asset'],
      ['ESCROW_CASH','Escrow Cash','asset'],
      ['PLATFORM_REVENUE','Platform Revenue','revenue'],
      ['CUSTOMER_FUNDING','Customer Funding Clearing','liability'],
      ['SUPPLIER_PAYABLE','Supplier Payable','liability']
    ];
    for (const [code, name, type] of accounts) {
      await client.query(
        `INSERT INTO accounts (account_code, account_name, account_type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [code, name, type]
      );
    }

    await client.query('COMMIT');
    console.log('Seed complete.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
  } finally {
    client.release();
    await pool.end();
  }
}
seed();
