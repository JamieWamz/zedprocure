const cron = require('node-cron');
const { randomUUID } = require('crypto');
const pool = require('../config/db');
const providers = require('./payments/paymentProviderRegistry');
const { applyProviderOutcome } = require('./escrowEngine');
const { withFinancialLock, LockBusyError } = require('./distributedLock');
const { logger } = require('./financialLogger');

async function reconcileOne(transaction) {
  try {
    await withFinancialLock(`reconcile:${transaction.id}`, async () => {
      const operation = transaction.status === 'PAYMENT_PENDING' ? 'collection' : 'disbursement';
      const provider = operation === 'collection' ? transaction.collection_provider : transaction.payout_provider;
      const reference = operation === 'collection' ? transaction.collection_reference : transaction.disbursement_reference;
      if (!provider || !reference) return;
      const result = await providers.queryTransaction(provider, reference, operation);
      const configuredTimeout = Number(process.env.PAYMENT_COLLECTION_TIMEOUT_MINUTES || 1440);
      const timeoutMinutes = Number.isFinite(configuredTimeout) ? Math.max(5, configuredTimeout) : 1440;
      const collectionExpired = operation === 'collection' && result.status === 'PENDING' &&
        Date.now() - new Date(transaction.initiated_at).getTime() >= timeoutMinutes * 60 * 1000;
      await applyProviderOutcome({
        reference,
        operation,
        outcome: collectionExpired ? 'FAILED' : result.status,
        raw: collectionExpired ? { ...result.raw, reconciliationFailure: 'COLLECTION_TIMEOUT' } : result.raw,
        correlationId: randomUUID(),
        failureCode: collectionExpired ? 'COLLECTION_TIMEOUT' : null,
        failureMessage: collectionExpired ? `Collection remained pending for ${timeoutMinutes} minutes` : null,
      });
    }, 25000);
  } catch (error) {
    await pool.query(
      `UPDATE escrow_transactions
       SET reconciliation_attempts=reconciliation_attempts+1, last_reconciled_at=now(),
           next_reconcile_at=now() + LEAST(interval '30 minutes', interval '1 minute' * power(2, LEAST(reconciliation_attempts, 5))),
           failure_stage='RECONCILIATION', failure_message=$1, updated_at=now()
       WHERE id=$2 AND status IN ('PAYMENT_PENDING','DISBURSEMENT_PENDING')`,
      [String(error.message).slice(0, 500), transaction.id]
    );
    logger.warn('escrow_reconciliation_failed', {
      escrowTransactionId: transaction.id, message: error.message,
    });
  }
}

async function reconcilePendingTransactions() {
  try {
    await withFinancialLock('reconciliation-worker', async () => {
      const { rows } = await pool.query(
        `SELECT * FROM escrow_transactions
         WHERE status IN ('PAYMENT_PENDING','DISBURSEMENT_PENDING')
           AND COALESCE(next_reconcile_at, updated_at + interval '5 minutes') <= now()
         ORDER BY COALESCE(next_reconcile_at, updated_at) ASC LIMIT 50`
      );
      for (const transaction of rows) await reconcileOne(transaction);
      if (rows.length) logger.info('escrow_reconciliation_batch', { count: rows.length });
    }, 55000);
  } catch (error) {
    if (!(error instanceof LockBusyError)) logger.error('escrow_reconciliation_worker_failed', { message: error.message });
  }
}

cron.schedule('* * * * *', reconcilePendingTransactions);
logger.info('escrow_reconciliation_worker_started', { interval: '1 minute', staleAfter: '5 minutes' });

module.exports = { reconcilePendingTransactions, reconcileOne };
