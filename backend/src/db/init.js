/**
 * Database initialization script for production.
 * Updates platform admin passwords from environment variables on startup.
 * Seeds essential data like the chart of accounts.
 *
 * Database schema migrations are now handled by `node-pg-migrate` and are
 * run as part of the deployment build step, not at application startup.
 * This runs before the server starts in production.
 */
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function init() {
  // Ensure uploads directory exists
  const uploadsDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('Created uploads directory.');
  }

  const client = await pool.connect();
  try {
    // Update System Admin password if provided
    const systemAdminEmail = process.env.SYSTEM_ADMIN_EMAIL || 'wamuyuwamundia@gmail.com';
    if (process.env.SYSTEM_ADMIN_PASSWORD && process.env.SYSTEM_ADMIN_PASSWORD.length >= 10 && systemAdminEmail) {
      const sysHash = await bcrypt.hash(process.env.SYSTEM_ADMIN_PASSWORD, 12);
      await client.query(
        `UPDATE platform_admins SET password_hash=$1 WHERE email=$2`,
        [sysHash, systemAdminEmail]
      );
      console.log(`System admin password updated for ${systemAdminEmail}.`);
    }

    // Update Business Admin password if provided
    const businessAdminEmail = process.env.BUSINESS_ADMIN_EMAIL || 'brightilunga6@gmail.com';
    if (process.env.BUSINESS_ADMIN_PASSWORD && process.env.BUSINESS_ADMIN_PASSWORD.length >= 10 && businessAdminEmail) {
      const bizHash = await bcrypt.hash(process.env.BUSINESS_ADMIN_PASSWORD, 12);
      await client.query(
        `UPDATE platform_admins SET password_hash=$1 WHERE email=$2`,
        [bizHash, businessAdminEmail]
      );
      console.log(`Business admin password updated for ${businessAdminEmail}.`);
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