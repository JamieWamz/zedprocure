/**
 * Unified Payment Service
 *
 * Single entry point for all payment providers.
 * Routes calls to the correct provider and keeps DB in sync.
 *
 * Supported providers: 'mtn' | 'airtel' | 'zamtel' | 'bank'
 */

const pool       = require('../../config/db');
const mtnMomo    = require('./mtnMomoService');
const airtel     = require('./airtelMoneyService');
const zamtel     = require('./zamtelKwachaService');

const PROVIDERS = ['mtn', 'airtel', 'zamtel', 'bank'];

/**
 * Initiate a payment and persist it to the payments_log table.
 *
 * @param {object} params
 * @param {string} params.provider     - 'mtn' | 'airtel' | 'zamtel' | 'bank'
 * @param {string} params.amount       - Positive ZMW amount e.g. "2500.00"
 * @param {string} params.msisdn       - Mobile number for MoMo providers (260...)
 * @param {string} params.orderId      - UUID of the associated order
 * @param {string} params.description  - Short description shown to customer
 * @param {string} params.initiatedBy  - UUID of user initiating the payment
 * @returns {{ paymentLogId: string, providerReference: string }}
 */
async function initiatePayment({ provider, amount, msisdn, orderId, description, initiatedBy }) {
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported payment provider: "${provider}". Must be one of: ${PROVIDERS.join(', ')}`);
  }
  if (!amount || Number(amount) <= 0) {
    throw new Error('Payment amount must be a positive number');
  }

  let providerReference;

  if (provider === 'mtn') {
    providerReference = await mtnMomo.requestToPay(amount, msisdn, orderId, description);
  } else if (provider === 'airtel') {
    providerReference = await airtel.collect(amount, msisdn, orderId);
  } else if (provider === 'zamtel') {
    providerReference = await zamtel.requestPayment(amount, msisdn, orderId);
  } else {
    // Bank — reference is set manually or via callback; assign a local ref
    providerReference = `BANK-${orderId}`;
  }

  const { rows: [log] } = await pool.query(
    `INSERT INTO payments_log (order_id, provider, provider_reference, amount, status, initiated_by)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING id`,
    [orderId, provider, providerReference, amount, initiatedBy]
  );

  return { paymentLogId: log.id, providerReference };
}

/**
 * Sync payment status from the provider and update the DB.
 * Also funds the escrow account if payment became successful.
 *
 * @param {string} paymentLogId
 * @returns {'pending'|'successful'|'failed'}
 */
async function syncPaymentStatus(paymentLogId) {
  const { rows: [payment] } = await pool.query(
    'SELECT * FROM payments_log WHERE id = $1',
    [paymentLogId]
  );
  if (!payment) throw new Error(`Payment log ${paymentLogId} not found`);

  // Skip polling for completed payments
  if (['successful', 'failed'].includes(payment.status)) return payment.status;

  let newStatus = 'pending';

  try {
    if (payment.provider === 'mtn') {
      const raw = await mtnMomo.getPaymentStatus(payment.provider_reference);
      if (raw === 'SUCCESSFUL') newStatus = 'successful';
      else if (raw === 'FAILED') newStatus = 'failed';
    } else if (payment.provider === 'airtel') {
      const raw = await airtel.getStatus(payment.provider_reference);
      if (raw === 'TS') newStatus = 'successful';
      else if (raw === 'TF') newStatus = 'failed';
    } else if (payment.provider === 'zamtel') {
      const raw = await zamtel.getStatus(payment.provider_reference);
      if (raw === 'SUCCESSFUL') newStatus = 'successful';
      else if (raw === 'FAILED') newStatus = 'failed';
    } else {
      // Bank payments are updated via webhook only
      return payment.status;
    }
  } catch (err) {
    console.error(`[PaymentService] Error polling ${payment.provider} for ${paymentLogId}:`, err.message);
    return 'pending'; // Don't mark as failed on network error — retry next poll
  }

  if (newStatus !== payment.status) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE payments_log SET status = $1, updated_at = now() WHERE id = $2',
        [newStatus, paymentLogId]
      );

      // When payment succeeds → fund the escrow account for this order
      if (newStatus === 'successful') {
        await client.query(
          `UPDATE escrow_accounts
           SET status = 'funded', amount = $1, funded_at = now()
           WHERE order_id = $2`,
          [payment.amount, payment.order_id]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  return newStatus;
}

/**
 * Process an inbound webhook callback from a provider.
 * Call this from the /api/payments/callback route after verifying the request.
 *
 * @param {string} provider  - 'mtn' | 'airtel' | 'zamtel' | 'bank'
 * @param {object} payload   - Raw parsed JSON body from provider
 */
async function processWebhook(provider, payload) {
  let providerReference, newStatus;

  if (provider === 'mtn') {
    providerReference = payload.externalId;
    newStatus = payload.status === 'SUCCESSFUL' ? 'successful' : 'failed';
  } else if (provider === 'airtel') {
    providerReference = payload.transaction?.id;
    const raw = payload.transaction?.status;
    newStatus = raw === 'TS' ? 'successful' : 'failed';
  } else if (provider === 'zamtel') {
    providerReference = payload.transactionId || payload.reference;
    const raw = (payload.status || '').toUpperCase();
    newStatus = (raw === 'SUCCESSFUL' || raw === 'SUCCESS') ? 'successful' : 'failed';
  } else if (provider === 'bank') {
    providerReference = payload.reference || payload.transactionRef;
    newStatus = payload.status?.toLowerCase() === 'success' ? 'successful' : 'failed';
  }

  if (!providerReference) {
    console.warn(`[Webhook] Could not extract providerReference from ${provider} payload`, payload);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [payment] } = await client.query(
      `UPDATE payments_log
       SET status = $1, provider_callback_payload = $2, updated_at = now()
       WHERE provider_reference = $3 AND provider = $4
       RETURNING *`,
      [newStatus, JSON.stringify(payload), providerReference, provider]
    );

    if (payment && newStatus === 'successful') {
      await client.query(
        `UPDATE escrow_accounts
         SET status = 'funded', amount = $1, funded_at = now()
         WHERE order_id = $2`,
        [payment.amount, payment.order_id]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { initiatePayment, syncPaymentStatus, processWebhook };
