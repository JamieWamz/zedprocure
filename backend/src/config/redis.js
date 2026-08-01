const { createClient } = require('redis');
const { logger } = require('../services/financialLogger');

let client;
let connectPromise;

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', err => logger.error('redis_error', { message: err.message }));
  }
  if (!client.isOpen) {
    connectPromise ||= client.connect().catch(err => {
      connectPromise = null;
      logger.warn('redis_unavailable_using_postgres_guards', { message: err.message });
      return null;
    });
    await connectPromise;
  }
  return client.isReady ? client : null;
}

module.exports = { getRedis };
