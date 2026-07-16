const { Pool } = require('pg');
require('dotenv').config();

// SSL is enabled when DATABASE_SSL=true or when the DATABASE_URL contains sslmode.
// This allows local Docker (NODE_ENV=production, no SSL) to work correctly
// while Render's managed Postgres (which requires SSL) still gets it.
const dbUrl = process.env.DATABASE_URL || '';
const sslEnabled = process.env.DATABASE_SSL === 'true' || dbUrl.includes('sslmode=require');

const pool = new Pool({
  connectionString: dbUrl,
  ssl: sslEnabled ? { rejectUnauthorized: false } : false,
});

module.exports = pool;