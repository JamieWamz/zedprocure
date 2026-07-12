const { Pool } = require('pg');
require('dotenv').config();

const maxRetries = 5;
const retryDelay = 5000;

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });
}

async function getPool() {
  if (!poolInstance) {
    poolInstance = createPool();

    poolInstance.on('error', (err) => {
      console.error('Unexpected database connection error:', err);
    });
  }

  if (!poolReady) {
    let retries = 0;
    while (retries < maxRetries) {
      try {
        const client = await poolInstance.connect();
        await client.query('SELECT 1');
        client.release();
        poolReady = true;
        console.log('Database connection established successfully');
        return poolInstance;
      } catch (err) {
        retries++;
        console.error(`Database connection attempt ${retries}/${maxRetries} failed:`, err.message);
        if (retries >= maxRetries) {
          throw new Error('Failed to connect to database after maximum retries');
        }
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  return poolInstance;
}

let poolInstance = null;
let poolReady = false;
let initAttempted = false;

// Start connecting immediately but don't block module export
(async () => {
  if (!initAttempted) {
    initAttempted = true;
    try {
      await getPool();
    } catch (err) {
      console.error('Initial database connection failed:', err);
    }
  }
})();

const pool = {
  query: (...args) => getPool().then(p => p.query(...args)),
  connect: () => getPool().then(p => p.connect())
};

module.exports = pool;
