const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const {
  recordEscrowFunding, recordSubsidyFunding, recordEscrowRelease, recordEscrowRefund,
} = require('../services/ledgerService');
const { ensureWallet, creditWallet } = require('../services/walletService');
const { requireEnum, requireUuid, cleanText } = require('../utils/requestValidation');
const router = express.Router();

// Customer funds escrow
router.post('/escrow/fund', authenticate, async (req, res) => {
  if (req.user.user_type !== 'tenant_user' || req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Only customers can fund escrow' });
  }
  const { amount } = req.body;
  let order_id;
  let payment_method;
  let transaction_ref;
  try {
    order_id = requireUuid(req.body.order_id, 'order_id');
    payment_method = requireEnum(req.body.payment_method, ['mobile_money', 'bank_transfer'], 'payment_method');
    transaction_ref = cleanText(req.body.transaction_ref, { required: true, maxLength: 100 });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!order_id || !payment_method || !transaction_ref) {
    return res.status(400).json({ error: 'order_id, payment_method and transaction_ref are required' });
  }
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'Invalid funding amount' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [order] } = await client.query(
      `SELECT b.tenant_id, o.total_amount, o.supplier_payout_amount,
              o.platform_revenue_amount, o.subsidy_amount, o.status
       FROM orders o JOIN bids b ON b.id = o.bid_id WHERE o.id = $1 FOR UPDATE OF o`,
      [order_id]
    );
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.tenant_id !== req.user.tenant_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (['completed', 'disputed'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This order can no longer be funded' });
    }
    if (amountNum !== Number(order.total_amount)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Funding amount must match the order total' });
    }

    // Lock the escrow row so concurrent requests cannot both pass the status check.
    const { rows: [existingEscrow] } = await client.query(
      `SELECT status FROM escrow_accounts WHERE order_id = $1 FOR UPDATE`,
      [order_id]
    );
    if (existingEscrow) {
      if (existingEscrow.status === 'funded' || existingEscrow.status === 'released') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Escrow is already funded' });
      }
      if (existingEscrow.status === 'refunded') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Escrow has been refunded' });
      }
    }

    await client.query(
      `INSERT INTO escrow_accounts
         (order_id, customer_user_id, amount, supplier_payout_amount, platform_fee_amount, subsidy_amount, status, funded_at)
       VALUES ($1,$2,$3,$4,$5,$6,'funded',now())
       ON CONFLICT (order_id) DO UPDATE SET status = 'funded', funded_at = now(),
         amount = EXCLUDED.amount, supplier_payout_amount = EXCLUDED.supplier_payout_amount,
         platform_fee_amount = EXCLUDED.platform_fee_amount, subsidy_amount = EXCLUDED.subsidy_amount`,
      [order_id, req.user.user_id, amountNum, order.supplier_payout_amount,
       Math.max(0, Number(order.platform_revenue_amount || 0)), order.subsidy_amount]
    );
    await client.query(
      `INSERT INTO payment_transactions (from_user_id, amount, payment_method, transaction_ref, type, status)
       VALUES ($1,$2,$3,$4,'escrow_funding','completed')`,
      [req.user.user_id, amountNum, payment_method, transaction_ref]
    );
    await recordEscrowFunding(order_id, req.user.user_id, amountNum, client);
    await recordSubsidyFunding(order_id, req.user.user_id, order.subsidy_amount, client);

    await client.query('COMMIT');
    res.json({ message: 'Escrow funded' });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Transaction reference already exists' });
    }
    console.error('Error funding escrow:', e);
    res.status(500).json({ error: 'Failed to fund escrow' });
  } finally {
    client.release();
  }
});

// Business Admin releases escrow to supplier after fulfillment checks.
// Credits the supplier's in-app wallet atomically.
router.post('/escrow/release', authenticate, requireRole('business_admin'), async (req, res) => {
  let order_id;
  try {
    order_id = requireUuid(req.body.order_id, 'order_id');
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [escrow] } = await client.query(
      `SELECT ea.*, o.awarded_supplier_id FROM escrow_accounts ea
       JOIN orders o ON o.id = ea.order_id
       JOIN bids b ON b.id = o.bid_id
       WHERE ea.order_id = $1 FOR UPDATE OF ea`,
      [order_id]
    );
    if (!escrow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Escrow not found' });
    }
    if (escrow.status !== 'funded') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Escrow not funded' });
    }

    // Get the supplier users to credit their wallets
    const { rows: [supplierUser] } = await client.query(
      'SELECT id FROM supplier_users WHERE supplier_id = $1 AND is_active = TRUE ORDER BY id LIMIT 1',
      [escrow.awarded_supplier_id]
    );
    if (!supplierUser) throw new Error('Awarded supplier has no active payout user');
    const supplierPayout = Number(escrow.supplier_payout_amount || escrow.amount);
    const platformRevenue = Number(escrow.platform_fee_amount || 0);
    const subsidyAmount = Number(escrow.subsidy_amount || 0);
    const wallet = await ensureWallet(supplierUser.id, 'supplier_user', client);
    await creditWallet(
      wallet.id,
      supplierPayout,
      `Escrow release from order ${order_id}`,
      client,
      { reference: `escrow-release:${order_id}` }
    );

    await client.query(
      'UPDATE escrow_accounts SET status = $1, released_at = now() WHERE order_id = $2',
      ['released', order_id]
    );

    // Record double-entry ledger
    await recordEscrowRelease(order_id, req.user.user_id, {
      gross: Number(escrow.amount),
      supplierPayout,
      platformRevenue,
      subsidyAmount,
    }, client);

    await client.query('COMMIT');
    res.json({ message: 'Escrow released to supplier wallet', supplier_payout: supplierPayout });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error releasing escrow:', e);
    res.status(500).json({ error: 'Failed to release escrow' });
  } finally {
    client.release();
  }
});

// Business Admin refunds escrow back to customer.
// Reverse the journal entries and credit customer wallet.
router.post('/escrow/refund', authenticate, requireRole('business_admin'), async (req, res) => {
  let order_id;
  let reason;
  try {
    order_id = requireUuid(req.body.order_id, 'order_id');
    reason = cleanText(req.body.reason, { maxLength: 1000 });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!order_id) return res.status(400).json({ error: 'order_id is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [escrow] } = await client.query(
      `SELECT ea.*, o.awarded_supplier_id FROM escrow_accounts ea
       JOIN orders o ON o.id = ea.order_id
       WHERE ea.order_id = $1 FOR UPDATE OF ea`,
      [order_id]
    );
    if (!escrow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Escrow not found' });
    }
    if (escrow.status !== 'funded') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Escrow must be in funded state to refund. Current state: ' + escrow.status });
    }

    // Credit the customer's wallet
    const wallet = await ensureWallet(escrow.customer_user_id, 'tenant_user', client);
    if (wallet.id) {
      await creditWallet(
        wallet.id,
        escrow.amount,
        `Escrow refund for order ${order_id}${reason ? ': ' + reason : ''}`,
        client
      );
    }

    // Mark escrow as refunded
    await client.query(
      'UPDATE escrow_accounts SET status = $1 WHERE order_id = $2',
      ['refunded', order_id]
    );
    await recordEscrowRefund(
      order_id,
      req.user.user_id,
      Number(escrow.amount),
      Number(escrow.subsidy_amount || 0),
      client
    );

    // Record reversal in payment_transactions
    await client.query(
      `INSERT INTO payment_transactions (from_user_id, to_user_id, amount, payment_method, transaction_ref, type, status, gateway_response)
       VALUES ($1, $2, $3, $4, $5, 'refund', 'completed', $6)`,
      [req.user.user_id, escrow.customer_user_id, escrow.amount, 'bank_transfer',
       `REF-${Date.now()}-${require('crypto').randomUUID().slice(0, 8)}`,
       JSON.stringify({ reason: reason || null, escrow_id: escrow.id, order_id })]
    );

    await client.query('COMMIT');
    res.json({ message: 'Escrow refunded to customer wallet', amount: escrow.amount });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error refunding escrow:', e);
    res.status(500).json({ error: 'Failed to refund escrow' });
  } finally {
    client.release();
  }
});

module.exports = router;
