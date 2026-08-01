const crypto = require('crypto');
const pool = require('../config/db');
const providers = require('./payments/paymentProviderRegistry');
const { applyProviderOutcome, safeProviderPayload } = require('./escrowEngine');
const { withFinancialLock } = require('./distributedLock');
const { logger } = require('./financialLogger');
const { getRedis } = require('../config/redis');

async function processVerifiedWebhook({ provider, rawBody, headers, correlationId }) {
  provider = providers.normalizeProvider(provider);
  if (!providers.verifyWebhook(provider, rawBody, headers)) {
    const error = new Error('Invalid webhook signature or bearer token');
    error.status = 401;
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    const error = new Error('Webhook body must contain valid JSON');
    error.status = 400;
    throw error;
  }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    const error = new Error('Webhook payload must be an object');
    error.status = 400;
    throw error;
  }

  const idempotencyKey = providers.webhookIdempotencyKey(provider, payload, headers, rawBody);
  const payloadDigest = crypto.createHash('sha256').update(rawBody).digest('hex');
  return withFinancialLock(`webhook:${provider}:${idempotencyKey}`, async () => {
    const redis = await getRedis();
    const redisIdempotencyKey = `webhook-idempotency:${provider}:${idempotencyKey}`;
    if (redis && await redis.get(redisIdempotencyKey)) {
      return { duplicate: true, status: 'PROCESSED' };
    }
    const { rows: [log] } = await pool.query(
      `INSERT INTO webhook_logs
         (provider, idempotency_key, payload, payload_sha256, signature_verified, correlation_id)
       VALUES ($1,$2,$3,$4,TRUE,$5)
       ON CONFLICT (provider, idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [provider, idempotencyKey, JSON.stringify(safeProviderPayload(payload)), payloadDigest, correlationId]
    );
    if (['PROCESSED', 'IGNORED'].includes(log.processing_status)) {
      return { duplicate: true, status: log.processing_status };
    }

    try {
      const event = providers.normalizeWebhook(provider, payload, headers);
      const { rows: [disbursement] } = await pool.query(
        'SELECT id FROM escrow_transactions WHERE disbursement_reference=$1', [event.reference]
      );
      if (disbursement) event.operation = 'disbursement';
      const referenceColumn = event.operation === 'disbursement' ? 'disbursement_reference' : 'collection_reference';
      const { rows: [currentEscrow] } = await pool.query(
        `SELECT id FROM escrow_transactions WHERE ${referenceColumn}=$1`, [event.reference]
      );
      if (!currentEscrow) {
        const { rows: [supersededAttempt] } = await pool.query(
          `SELECT id FROM payments_log WHERE provider=$1 AND provider_reference=$2 AND status='failed'`,
          [provider.toLowerCase(), event.reference]
        );
        if (supersededAttempt) {
          await pool.query(
            `UPDATE webhook_logs SET event_type=$1, processing_status='IGNORED', processed_at=now(),
               error_message='Superseded failed payment attempt' WHERE id=$2`, [event.eventType, log.id]
          );
          if (redis) await redis.set(redisIdempotencyKey, 'IGNORED', { EX: 7 * 24 * 60 * 60 });
          return { duplicate: false, status: 'IGNORED' };
        }
      }
      const status = await applyProviderOutcome({
        reference: event.reference,
        operation: event.operation,
        outcome: event.status,
        raw: payload,
        correlationId,
        failureCode: event.failureCode,
        failureMessage: event.failureMessage,
      });
      await pool.query(
        `UPDATE webhook_logs SET event_type=$1, processing_status='PROCESSED', processed_at=now(),
           escrow_transaction_id=(SELECT id FROM escrow_transactions
             WHERE collection_reference=$2 OR disbursement_reference=$2 LIMIT 1)
         WHERE id=$3`,
        [event.eventType, event.reference, log.id]
      );
      if (redis) await redis.set(redisIdempotencyKey, 'PROCESSED', { EX: 7 * 24 * 60 * 60 });
      return { duplicate: false, status };
    } catch (error) {
      await pool.query(
        `UPDATE webhook_logs SET processing_status='FAILED', error_message=$1, processed_at=now() WHERE id=$2`,
        [String(error.message).slice(0, 500), log.id]
      );
      logger.error('webhook_processing_failed', {
        provider, idempotencyKey, correlationId, message: error.message,
      });
      throw error;
    }
  });
}

module.exports = { processVerifiedWebhook };
