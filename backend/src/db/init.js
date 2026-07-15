/**
 * Database initialization script for production.
 * Updates platform admin passwords from environment variables on startup.
 * This runs before the server starts in production.
 */
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function init() {
  const client = await pool.connect();
  try {
    // Update System Admin password if provided
    if (process.env.SYSTEM_ADMIN_PASSWORD && process.env.SYSTEM_ADMIN_PASSWORD.length >= 10) {
      const sysHash = await bcrypt.hash(process.env.SYSTEM_ADMIN_PASSWORD, 12);
      await client.query(
        `UPDATE platform_admins SET password_hash=$1 WHERE email='wamuyuwamundia@gmail.com'`,
        [sysHash]
      );
      console.log('System admin password updated from environment.');
    }

    // Update Business Admin password if provided
    if (process.env.BUSINESS_ADMIN_PASSWORD && process.env.BUSINESS_ADMIN_PASSWORD.length >= 10) {
      const bizHash = await bcrypt.hash(process.env.BUSINESS_ADMIN_PASSWORD, 12);
      await client.query(
        `UPDATE platform_admins SET password_hash=$1 WHERE email='brightilunga6@gmail.com'`,
        [bizHash]
      );
      console.log('Business admin password updated from environment.');
    }

    // Chart of accounts (idempotent)
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

    console.log('Database initialization complete.');
  } catch (e) {
    console.error('Database initialization error:', e);
    process.exit(1);
  } finally {
    client.release();
  }
}

module.exports = { init };