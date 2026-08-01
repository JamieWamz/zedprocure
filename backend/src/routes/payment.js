const express = require('express');
const pool = require('../config/db');
const { randomUUID } = require('crypto');
const { authenticate } = require('../middleware/authMiddleware');
const { recordBiddingFee } = require('../services/ledgerService');
const { consumeBidAccess, BidAccessError } = require('../services/bidFeeService');
const { requireUuid, requireEnum, cleanText } = require('../utils/requestValidation');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const biddingFeeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many bidding-fee attempts. Please wait before trying again.' },
});

// Initiate bidding fee payment (returns a payment reference)
router.post('/payments/bidding-fee', biddingFeeLimiter, authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    const bid_id = requireUuid(req.body.bid_id, 'bid_id');
    const payment_method = requireEnum(req.body.payment_method || 'wallet', ['wallet'], 'payment_method');
    const { rows: [bid] } = await pool.query(
      `SELECT b.bidding_fee_amount, b.status, b.deadline, s.id AS supplier_id
       FROM bids b
       JOIN bid_suppliers bs ON bs.bid_id = b.id
       JOIN suppliers s ON s.id = bs.supplier_id
       JOIN supplier_users su ON su.supplier_id = bs.supplier_id
       WHERE b.id = $1 AND su.id = $2`,
      [bid_id, req.user.user_id]
    );
    if (!bid) return res.status(404).json({ error: 'Bid invitation not found' });
    if (!['open', 'evaluation'].includes(bid.status) || new Date(bid.deadline) <= new Date()) {
      return res.status(422).json({ error: 'This bid is not accepting fee payments' });
    }
    const { rows: [existingCharge] } = await pool.query(
      `SELECT charge_source, amount, status FROM bid_fee_charges
       WHERE bid_id = $1 AND supplier_id = $2`,
      [bid_id, bid.supplier_id]
    );
    if (existingCharge?.status === 'completed') {
      return res.json({ status: 'completed', access_source: existingCharge.charge_source });
    }
    const ref = `BID-${Date.now()}-${randomUUID().slice(0,8)}`;
    const { rows: [transaction] } = await pool.query(
      `INSERT INTO payment_transactions (from_user_id, amount, payment_method, transaction_ref, type, status, bid_id)
       VALUES ($1,$2,$3,$4,'bidding_fee','initiated',$5) RETURNING id`,
      [req.user.user_id, bid.bidding_fee_amount, payment_method, ref, bid_id]
    );
    res.status(201).json({ transaction_ref: ref, transaction_id: transaction.id, status: 'initiated' });
  } catch (e) {
    console.error('Error initiating bidding fee:', e);
    res.status(e.message?.includes('must be') ? 400 : 500).json({ error: e.message || 'Failed to initiate payment' });
  }
});

// Confirm payment (manual or callback) – idempotent via unique ref
// Debits the user's wallet and records the ledger entry atomically.
router.post('/payments/confirm', biddingFeeLimiter, authenticate, async (req, res) => {
  try {
    const transaction_ref = typeof req.body.transaction_ref === 'string' ? req.body.transaction_ref.trim() : '';
    if (!/^BID-[A-Za-z0-9-]{10,100}$/.test(transaction_ref)) {
      return res.status(400).json({ error: 'A valid transaction_ref is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [tx] } = await client.query(
        `SELECT * FROM payment_transactions
         WHERE transaction_ref = $1 AND from_user_id = $2 FOR UPDATE`,
        [transaction_ref, req.user.user_id]
      );
      if (!tx) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Transaction not found' });
      }
      if (tx.status === 'completed') {
        await client.query('ROLLBACK');
        return res.json({ message: 'Already confirmed', tx });
      }

      // If bidding fee, debit wallet and record ledger entry
      if (tx.type === 'bidding_fee') {
        if (!tx.bid_id) throw new Error('Bidding-fee transaction has no bid association');
        const charge = await consumeBidAccess({
          bidId: tx.bid_id,
          supplierUserId: tx.from_user_id,
          paymentTransactionId: tx.id,
          client,
        });

        // Record the double-entry ledger entry
        if (Number(charge.amount) > 0) {
          await recordBiddingFee(tx.bid_id, tx.from_user_id, charge.amount, transaction_ref, client);
        }
      }

      // Mark payment as completed
      await client.query(
        'UPDATE payment_transactions SET status = $1 WHERE transaction_ref = $2',
        ['completed', transaction_ref]
      );

      await client.query('COMMIT');
      res.json({ message: 'Bid access confirmed', transaction_ref });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Error confirming payment:', e);
    const status = e instanceof BidAccessError
      ? (e.code === 'PAYMENT_REQUIRED' ? 402 : 422)
      : (e.message === 'Insufficient wallet balance' ? 402 : 500);
    res.status(status).json({ error: 'Failed to confirm payment: ' + e.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// Mobile Money & Bank Payment Routes (MTN / Airtel / Zamtel / Bank)
// ═══════════════════════════════════════════════════════════════════════════

const { initiatePayment, syncPaymentStatus, processWebhook } = require('../services/payments/paymentService');
const { createCollection, syncEscrowPaymentStatus, money: normalizeMoney } = require('../services/escrowEngine');
const crypto = require('crypto');
const { processVerifiedWebhook } = require('../services/webhookService');

async function customerOrder(req, orderId) {
  if (req.user.user_type !== 'tenant_user' || req.user.role !== 'customer') return null;
  const { rows } = await pool.query(
    `SELECT o.id, o.total_amount, o.status, ea.status AS escrow_status,
            EXISTS(SELECT 1 FROM payments_log pl WHERE pl.order_id = o.id AND pl.status = 'pending') AS has_pending_payment
     FROM orders o JOIN bids b ON b.id = o.bid_id
     LEFT JOIN escrow_accounts ea ON ea.order_id = o.id
     WHERE o.id = $1 AND b.tenant_id = $2`,
    [orderId, req.user.tenant_id]
  );
  return rows[0] || null;
}

/**
 * POST /api/payments/mobile/initiate
 * Kick off a mobile money or bank payment for an order.
 * Body: { provider, amount, msisdn, orderId, description? }
 */
router.post('/payments/mobile/initiate', authenticate, async (req, res) => {
  let { provider, amount, msisdn, orderId, description } = req.body;

  provider = String(provider || '').toLowerCase();
  try {
    orderId = requireUuid(orderId, 'orderId');
    provider = requireEnum(provider, ['mtn', 'airtel', 'zamtel', 'bank'], 'provider');
    description = cleanText(description, { maxLength: 120 });
    if (['mtn', 'airtel', 'zamtel'].includes(provider)) {
      msisdn = String(msisdn || '').replace(/[\s()+-]/g, '');
      if (!/^260\d{9}$/.test(msisdn)) throw new Error('msisdn must be a valid Zambian number in 260XXXXXXXXX format');
    } else {
      // Bank collection can issue a transfer reference without collecting the
      // buyer's bank account in the browser.
      msisdn = String(req.body.account || orderId).trim();
    }
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  if (!provider || !amount || !orderId) {
    return res.status(400).json({ error: 'provider, amount, and orderId are required' });
  }
  if (['mtn', 'airtel', 'zamtel'].includes(provider) && !msisdn) {
    return res.status(400).json({ error: 'msisdn is required for mobile money providers' });
  }
  if (Number(amount) <= 0) {
    return res.status(400).json({ error: 'amount must be greater than zero' });
  }

  try {
    const order = await customerOrder(req, orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }
    if (['completed', 'disputed'].includes(order.status)) {
      return res.status(400).json({ error: 'This order can no longer be funded' });
    }
    if (['funded', 'released', 'refunded'].includes(order.escrow_status)) {
      return res.status(400).json({ error: 'This order already has a completed escrow transaction' });
    }
    if (order.has_pending_payment) {
      return res.status(409).json({ error: 'A payment for this order is already awaiting confirmation' });
    }
    // The amount is server-authoritative: never trust a value supplied by the browser.
    let requestedAmount;
    try {
      if (!/^\d{1,13}(\.\d{1,2})?$/.test(String(amount))) throw new Error('Invalid money format');
      requestedAmount = normalizeMoney(amount);
    } catch {
      return res.status(400).json({ error: 'amount must be a positive value with no more than two decimals' });
    }
    if (requestedAmount !== normalizeMoney(order.total_amount)) {
      return res.status(400).json({ error: 'Payment amount must match the order total' });
    }

    const result = provider === 'zamtel'
      ? await initiatePayment({
        provider, amount: order.total_amount, msisdn, orderId,
        description: description || 'ZedProcure Order Payment',
        initiatedBy: req.user.user_id,
      })
      : await createCollection({
        orderId,
        provider,
        destination: msisdn,
        buyer: req.user,
        description: description || 'ZedProcure Order Payment',
        correlationId: req.correlationId,
      });

    res.status(201).json(result);
  } catch (e) {
    console.error('[Payment] Initiation error:', e.message);
    const status = e.status || (e.code === '23505' ? 409 : (e.message.includes('not configured') ? 503 : 502));
    res.status(status).json({ error: e.message });
  }
});

/**
 * GET /api/payments/mobile/:paymentLogId/status
 * Poll & sync status from the provider. Returns current status.
 */
router.get('/payments/mobile/:paymentLogId/status', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pl.order_id FROM payments_log pl
       JOIN orders o ON o.id = pl.order_id JOIN bids b ON b.id = o.bid_id
       WHERE pl.id = $1 AND b.tenant_id = $2`,
      [req.params.paymentLogId, req.user.tenant_id]
    );
    if (req.user.user_type !== 'tenant_user' || req.user.role !== 'customer' || !rows.length) {
      return res.status(404).json({ error: 'Payment not found or access denied' });
    }
    const status = await syncEscrowPaymentStatus(req.params.paymentLogId, req.correlationId) ||
      await syncPaymentStatus(req.params.paymentLogId);
    res.json({ status });
  } catch (e) {
    console.error('[Payment] Status sync error:', e.message);
    res.status(404).json({ error: e.message });
  }
});

/**
 * GET /api/payments/mobile/order/:orderId
 * List all payment attempts for a given order.
 */
router.get('/payments/mobile/order/:orderId', authenticate, async (req, res) => {
  try {
    if (!await customerOrder(req, req.params.orderId)) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }
    const { rows } = await pool.query(
      `SELECT id, provider, provider_reference, amount, status, created_at, updated_at
       FROM payments_log
       WHERE order_id = $1
       ORDER BY created_at DESC`,
      [req.params.orderId]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

/**
 * POST /api/payments/mobile/callback
 * Inbound webhook from provider (MTN / Airtel / Zamtel / Bank).
 * Provider is identified via query param: ?provider=mtn
 *
 * Requires x-webhook-signature: sha256=<hex HMAC of the raw request body>.
 */
router.post('/payments/mobile/callback', async (req, res) => {
  const provider = req.query.provider;
  if (!provider) return res.status(400).json({ error: 'provider query parameter required' });

  try {
    const bodyStr = Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
    if (['mtn', 'airtel', 'bank'].includes(String(provider).toLowerCase())) {
      const result = await processVerifiedWebhook({
        provider,
        rawBody: Buffer.from(bodyStr),
        headers: req.headers,
        correlationId: req.correlationId,
      });
      return res.status(200).json({ received: true, duplicate: result.duplicate, status: result.status });
    }
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Webhook verification is not configured' });
    const supplied = String(req.get('x-webhook-signature') || '').replace(/^sha256=/, '');
    const expected = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');
    const validSignature = /^[a-f0-9]{64}$/i.test(supplied) && supplied.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'));
    if (!validSignature) return res.status(401).json({ error: 'Invalid webhook signature' });
    const payload = JSON.parse(bodyStr);
    await processWebhook(provider, payload);
    res.status(200).json({ received: true });
  } catch (e) {
    console.error('[Payment] Webhook error:', e.message);
    // A non-2xx response permits the provider to retry transient failures.
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
