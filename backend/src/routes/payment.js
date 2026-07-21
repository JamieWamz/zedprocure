const express = require('express');
const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/authMiddleware');
const { recordBiddingFee } = require('../services/ledgerService');
const { ensureWallet, debitWallet } = require('../services/walletService');
const router = express.Router();

// Initiate bidding fee payment (returns a payment reference)
router.post('/payments/bidding-fee', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { bid_id, payment_method } = req.body;
    const { rows: [bid] } = await pool.query(
      `SELECT b.bidding_fee_amount
       FROM bids b
       JOIN bid_suppliers bs ON bs.bid_id = b.id
       JOIN supplier_users su ON su.supplier_id = bs.supplier_id
       WHERE b.id = $1 AND su.id = $2`,
      [bid_id, req.user.user_id]
    );
    if (!bid) return res.status(404).json({ error: 'Bid invitation not found' });
    const ref = `BID-${Date.now()}-${uuidv4().slice(0,8)}`;
    await pool.query(
      `INSERT INTO payment_transactions (from_user_id, amount, payment_method, transaction_ref, type, status)
       VALUES ($1,$2,$3,$4,'bidding_fee','initiated')`,
      [req.user.user_id, bid.bidding_fee_amount, payment_method, ref]
    );
    res.status(201).json({ transaction_ref: ref, status: 'initiated' });
  } catch (e) {
    console.error('Error initiating bidding fee:', e);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

// Confirm payment (manual or callback) – idempotent via unique ref
// Debits the user's wallet and records the ledger entry atomically.
router.post('/payments/confirm', authenticate, async (req, res) => {
  try {
    const { transaction_ref } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [tx] } = await client.query(
        `SELECT * FROM payment_transactions WHERE transaction_ref = $1 FOR UPDATE`,
        [transaction_ref]
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
        const { bid_id } = req.body;
        if (!bid_id) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'bid_id is required for bid_fee payment confirmation' });
        }

        // Ensure the user has a wallet and debit it
        const wallet = await ensureWallet(tx.from_user_id, req.user.user_type);
        if (!wallet.id) {
          await client.query('ROLLBACK');
          return res.status(500).json({ error: 'Failed to locate wallet for user' });
        }

        await debitWallet(
          wallet.id,
          tx.amount,
          `Bidding fee payment for bid ${bid_id} - ref ${transaction_ref}`,
          client
        );

        // Record the double-entry ledger entry
        await recordBiddingFee(bid_id, tx.from_user_id, tx.amount, transaction_ref, client);
      }

      // Mark payment as completed
      await client.query(
        'UPDATE payment_transactions SET status = $1 WHERE transaction_ref = $2',
        ['completed', transaction_ref]
      );

      await client.query('COMMIT');
      res.json({ message: 'Payment confirmed', transaction_ref });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Error confirming payment:', e);
    res.status(500).json({ error: 'Failed to confirm payment: ' + e.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// Mobile Money & Bank Payment Routes (MTN / Airtel / Zamtel / Bank)
// ═══════════════════════════════════════════════════════════════════════════

const { initiatePayment, syncPaymentStatus, processWebhook } = require('../services/payments/paymentService');
const crypto = require('crypto');

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
  const { provider, amount, msisdn, orderId, description } = req.body;

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
    if (Number(amount) !== Number(order.total_amount)) {
      return res.status(400).json({ error: 'Payment amount must match the order total' });
    }

    const result = await initiatePayment({
      provider, amount: order.total_amount, msisdn, orderId,
      description: description || 'ZedProcure Order Payment',
      initiatedBy: req.user.user_id,
    });

    res.status(201).json(result);
  } catch (e) {
    console.error('[Payment] Initiation error:', e.message);
    const status = e.message.includes('not configured') ? 503 : 500;
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
    const status = await syncPaymentStatus(req.params.paymentLogId);
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
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

/**
 * POST /api/payments/mobile/callback
 * Inbound webhook from provider (MTN / Airtel / Zamtel / Bank).
 * Provider is identified via query param: ?provider=mtn
 *
 * NOTE: In production, validate the provider's HMAC signature before calling
 *       processWebhook. See PAYMENT_INTEGRATION.md §8 for details.
 */
router.post('/payments/mobile/callback', express.raw({ type: '*/*' }), async (req, res) => {
  const provider = req.query.provider;
  if (!provider) return res.status(400).json({ error: 'provider query parameter required' });

  try {
    const bodyStr = Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
    const payload = JSON.parse(bodyStr);
    await processWebhook(provider, payload);
    res.status(200).json({ received: true });
  } catch (e) {
    console.error('[Payment] Webhook error:', e.message);
    // Always return 200 to prevent provider retries from filling logs
    res.status(200).json({ received: true, warning: 'Processing error logged' });
  }
});

module.exports = router;
