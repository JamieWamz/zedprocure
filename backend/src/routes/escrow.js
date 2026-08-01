const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const { requireUuid, cleanText } = require('../utils/requestValidation');
const { triggerDisbursement, raiseDispute } = require('../services/escrowEngine');
const { LockBusyError } = require('../services/distributedLock');

const router = express.Router();
const escrowMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many escrow requests. Please wait before trying again.' },
});

// Manual references are not proof of settlement. All funding must enter through
// a verified provider collection or bank webhook.
router.post('/escrow/fund', authenticate, (_req, res) => {
  res.status(410).json({
    error: 'Manual escrow funding is disabled. Use the secure payment checkout.',
    next: '/api/payments/mobile/initiate',
  });
});

router.post('/escrow/release', escrowMutationLimiter, authenticate, async (req, res) => {
  try {
    const orderId = requireUuid(req.body.order_id, 'order_id');
    const reason = cleanText(req.body.reason, { maxLength: 500 });
    const result = await triggerDisbursement({
      orderId,
      actor: req.user,
      correlationId: req.correlationId,
      operation: 'RELEASE',
      reason,
    });
    res.status(202).json({ message: 'Supplier payout is being processed', ...result });
  } catch (error) {
    const status = error.status || (error instanceof LockBusyError ? 409 : 422);
    res.status(status).json({ error: error.message || 'Failed to release escrow' });
  }
});

router.post('/escrow/refund', escrowMutationLimiter, authenticate, async (req, res) => {
  try {
    const orderId = requireUuid(req.body.order_id, 'order_id');
    const reason = cleanText(req.body.reason, { required: true, maxLength: 500 });
    const result = await triggerDisbursement({
      orderId,
      actor: req.user,
      correlationId: req.correlationId,
      operation: 'REFUND',
      reason,
    });
    res.status(202).json({ message: 'Buyer refund is being processed', ...result });
  } catch (error) {
    const status = error.status || (error instanceof LockBusyError ? 409 : 422);
    res.status(status).json({ error: error.message || 'Failed to refund escrow' });
  }
});

router.post('/escrow/dispute', escrowMutationLimiter, authenticate, async (req, res) => {
  try {
    const orderId = requireUuid(req.body.order_id, 'order_id');
    const reason = cleanText(req.body.reason, { required: true, maxLength: 500 });
    const escrow = await raiseDispute({
      orderId,
      actor: req.user,
      reason,
      correlationId: req.correlationId,
    });
    res.status(201).json({ message: 'Dispute opened; payout is now on hold', status: escrow.status });
  } catch (error) {
    const status = error.status || (error instanceof LockBusyError ? 409 : 422);
    res.status(status).json({ error: error.message });
  }
});

router.get('/escrow/:orderId/status', authenticate, async (req, res) => {
  try {
    const orderId = requireUuid(req.params.orderId, 'order_id');
    const { rows: [escrow] } = await pool.query(
      `SELECT et.id, et.order_id, et.transaction_ref, et.amount, et.currency, et.platform_fee,
              et.payout_amount, et.status, et.collection_provider, et.payout_provider,
              et.collection_msisdn_last4, et.failure_stage, et.failure_code, et.failure_message,
              et.initiated_at, et.held_at, et.disbursement_requested_at, et.released_at,
              et.disputed_at, et.refunded_at, b.tenant_id, et.seller_id
       FROM escrow_transactions et JOIN orders o ON o.id=et.order_id JOIN bids b ON b.id=o.bid_id
       WHERE et.order_id=$1`, [orderId]
    );
    if (!escrow) return res.status(404).json({ error: 'Escrow transaction not found' });

    let allowed = req.user.user_type === 'platform_admin' ||
      (req.user.user_type === 'tenant_user' && req.user.tenant_id === escrow.tenant_id);
    if (req.user.user_type === 'supplier_user') {
      const { rows: [supplier] } = await pool.query(
        'SELECT supplier_id FROM supplier_users WHERE id=$1', [req.user.user_id]
      );
      allowed = supplier?.supplier_id === escrow.seller_id;
    }
    if (!allowed) return res.status(403).json({ error: 'Access denied' });
    delete escrow.tenant_id;
    delete escrow.seller_id;
    res.json(escrow);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
