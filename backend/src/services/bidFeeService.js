const { ensureWallet, debitWallet } = require('./walletService');

class BidAccessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BidAccessError';
    this.code = code;
  }
}

async function consumeBidAccess({ bidId, supplierUserId, paymentTransactionId = null, client }) {
  const { rows: [context] } = await client.query(
    `SELECT b.id AS bid_id, b.bidding_fee_amount, b.status, b.deadline,
            su.supplier_id, s.verification_status
     FROM bids b
     JOIN supplier_users su ON su.id = $2
     JOIN suppliers s ON s.id = su.supplier_id
     WHERE b.id = $1
     FOR UPDATE OF b, s`,
    [bidId, supplierUserId]
  );
  if (!context) throw new BidAccessError('NOT_FOUND', 'Bid or supplier account not found');
  if (!['open', 'evaluation'].includes(context.status) || new Date(context.deadline) <= new Date()) {
    throw new BidAccessError('BID_CLOSED', 'This bid is no longer accepting submissions');
  }
  if (context.verification_status !== 'verified') {
    throw new BidAccessError('SUPPLIER_NOT_VERIFIED', 'Supplier verification is required before bidding');
  }

  const { rows: [existing] } = await client.query(
    `SELECT * FROM bid_fee_charges WHERE bid_id = $1 AND supplier_id = $2 FOR UPDATE`,
    [bidId, context.supplier_id]
  );
  if (existing?.status === 'completed') return existing;

  const fee = Number(context.bidding_fee_amount || 0);
  let source = fee === 0 ? 'free' : null;
  let amount = 0;

  const { rows: [subscription] } = await client.query(
    `SELECT * FROM supplier_subscriptions
     WHERE supplier_id = $1 AND active = TRUE FOR UPDATE`,
    [context.supplier_id]
  );
  // An explicitly confirmed wallet transaction takes precedence. Subscription
  // allowances and credits are consumed only by the submission path.
  if (!source && !paymentTransactionId && subscription) {
    const now = Date.now();
    if (new Date(subscription.period_end).getTime() <= now) {
      await client.query(
        `UPDATE supplier_subscriptions
         SET bids_used = 0, period_start = date_trunc('month', now()),
             period_end = date_trunc('month', now()) + interval '1 month', updated_at = now()
         WHERE id = $1`,
        [subscription.id]
      );
      subscription.bids_used = 0;
    }
    if (Number(subscription.bids_used) < Number(subscription.monthly_bid_limit)) {
      await client.query(
        'UPDATE supplier_subscriptions SET bids_used = bids_used + 1, updated_at = now() WHERE id = $1',
        [subscription.id]
      );
      source = 'subscription';
    } else if (Number(subscription.bid_credits) > 0) {
      await client.query(
        'UPDATE supplier_subscriptions SET bid_credits = bid_credits - 1, updated_at = now() WHERE id = $1',
        [subscription.id]
      );
      source = 'bid_credit';
    }
  }

  if (!source) {
    if (!paymentTransactionId) {
      throw new BidAccessError('PAYMENT_REQUIRED', 'A bidding fee, bid credit, or subscription allowance is required');
    }
    const { rows: [payment] } = await client.query(
      `SELECT * FROM payment_transactions
       WHERE id = $1 AND bid_id = $2 AND from_user_id = $3 AND type = 'bidding_fee'
       FOR UPDATE`,
      [paymentTransactionId, bidId, supplierUserId]
    );
    if (!payment || !['initiated', 'completed'].includes(payment.status)) {
      throw new BidAccessError('INVALID_PAYMENT', 'The bidding-fee transaction is invalid');
    }
    if (Number(payment.amount) !== fee) {
      throw new BidAccessError('INVALID_PAYMENT', 'The bidding-fee amount no longer matches the server price');
    }
    const wallet = await ensureWallet(supplierUserId, 'supplier_user', client);
    await debitWallet(wallet.id, fee, `Bidding fee for bid ${bidId}`, client, {
      type: 'payment',
      reference: `bid-fee:${bidId}:${context.supplier_id}`,
    });
    source = 'wallet';
    amount = fee;
  }

  const { rows: [charge] } = await client.query(
    `INSERT INTO bid_fee_charges
       (bid_id, supplier_id, supplier_user_id, payment_transaction_id, charge_source, amount, status)
     VALUES ($1,$2,$3,$4,$5,$6,'completed')
     ON CONFLICT (bid_id, supplier_id) DO UPDATE SET status = 'completed'
     RETURNING *`,
    [bidId, context.supplier_id, supplierUserId, paymentTransactionId, source, amount]
  );
  return charge;
}

module.exports = { BidAccessError, consumeBidAccess };
