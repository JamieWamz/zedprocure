// Configuration for node-pg-migrate
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set.');
}

module.exports = {
  connectionString,
  migrationsTable: 'pgmigrations',
  dir: 'src/db/migrations', // Relative to the backend/ directory
  direction: 'up',
  log: (msg) => console.log(`[MIGRATE] ${msg}`),
};