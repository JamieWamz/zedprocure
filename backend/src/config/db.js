const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// Create a new pool instance with SSL configuration for production
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render's managed PostgreSQL requires SSL.
  // The 'rejectUnauthorized: false' is safe and necessary for connections
  // within Render's private network.
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

module.exports = pool;