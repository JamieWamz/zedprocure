const { randomUUID } = require('crypto');
const pool = require('../config/db');
const { getRedis } = require('../config/redis');

const RELEASE_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
`;

class LockBusyError extends Error {
  constructor() {
    super('This financial operation is already being processed');
    this.code = 'LOCK_BUSY';
  }
}

async function withFinancialLock(key, fn, ttlMs = 30000) {
  const redis = await getRedis();
  const redisKey = `financial-lock:${key}`;
  const token = randomUUID();
  let pgClient;

  try {
    if (redis) {
      const acquired = await redis.set(redisKey, token, { NX: true, PX: ttlMs });
      if (!acquired) throw new LockBusyError();
    } else {
      // Dedicated session-level advisory lock is the safe fallback when Redis is down.
      pgClient = await pool.connect();
      const { rows: [result] } = await pgClient.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [key]
      );
      if (!result.acquired) throw new LockBusyError();
    }
    return await fn();
  } finally {
    if (redis) {
      await redis.eval(RELEASE_SCRIPT, { keys: [redisKey], arguments: [token] }).catch(() => {});
    }
    if (pgClient) {
      await pgClient.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {});
      pgClient.release();
    }
  }
}

module.exports = { withFinancialLock, LockBusyError };
