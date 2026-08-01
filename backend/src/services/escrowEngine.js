const crypto = require('crypto');
const pool = require('../config/db');
const providers = require('./payments/paymentProviderRegistry');
const { transitionEscrow } = require('./escrowStateMachine');
const { withFinancialLock } = require('./distributedLock');
const { encryptDestination, decryptDestination } = require('../utils/financialCrypto');
const { recordEscrowFunding, recordSubsidyFunding, recordEscrowRelease, recordEscrowRefund } = require('./ledgerService');
const { logger } = require('./financialLogger');

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error('Amount must be a positive number');
  return number.toFixed(2);
}

function maskLast4(value) {
  const compact = String(value || '').replace(/\s+/g, '');
  if (compact.length < 4 || compact.length > 64) throw new Error('Payment destination is invalid');
  return compact.slice(-4);
}

function safeProviderPayload(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const sensitive = /^(payer|payee|subscriber|msisdn|account|account_number|phone|phone_number|authorization|token)$/i;
  const redact = (value, depth = 0) => {
    if (depth > 12) return '[TRUNCATED]';
    if (Array.isArray(value)) return value.map(item => redact(item, depth + 1));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
      key,
      sensitive.test(key) ? '[REDACTED]' : redact(nested, depth + 1),
    ]));
  };
  return redact(JSON.parse(JSON.stringify(raw)));
}

function actorContext(actor, correlationId, reason, metadata) {
  return {
    actorId: actor?.user_id || null,
    actorType: actor?.user_type || 'system',
    correlationId,
    reason,
    metadata,
  };
}

async function createCollection({ orderId, provider, destination, buyer, description, correlationId }) {
  provider = providers.normalizeProvider(provider);
  let transactionRef = crypto.randomUUID();
  let providerReference = transactionRef;
  const result = await withFinancialLock(`collection:${orderId}`, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [order] } = await client.query(
        `SELECT o.*, b.tenant_id FROM orders o JOIN bids b ON b.id = o.bid_id
         WHERE o.id = $1 FOR UPDATE OF o`, [orderId]
      );
      if (!order || buyer.user_type !== 'tenant_user' || order.tenant_id !== buyer.tenant_id) {
        const error = new Error('Order not found or access denied');
        error.status = 404;
        throw error;
      }
      if (['completed', 'disputed'].includes(order.status)) throw new Error('This order cannot be funded');

      const { rows: [existing] } = await client.query(
        'SELECT * FROM escrow_transactions WHERE order_id = $1 FOR UPDATE', [orderId]
      );
      if (existing) {
        if (existing.status === 'PAYMENT_PENDING') {
          const duplicate = new Error('A payment for this order is already pending');
          duplicate.status = 409;
          duplicate.existing = existing;
          throw duplicate;
        }
        if (existing.status !== 'FAILED' || !String(existing.failure_stage || '').startsWith('COLLECTION')) {
          throw new Error(`Order already has an escrow transaction in ${existing.status}`);
        }
      }

      const amount = money(order.total_amount);
      const payoutAmount = money(order.supplier_payout_amount || order.total_amount);
      const platformFee = Math.max(0, Number(order.platform_revenue_amount || 0)).toFixed(2);
      let escrow;
      if (existing) {
        transactionRef = existing.transaction_ref;
        providerReference = crypto.randomUUID();
        const { rows: [retry] } = await client.query(
          `UPDATE escrow_transactions SET collection_provider=$1, collection_reference=$2,
             encrypted_collection_destination=$3, collection_msisdn_last4=$4,
             pending_operation='COLLECTION', failure_stage=NULL, failure_code=NULL,
             failure_message=NULL, failed_at=NULL, next_reconcile_at=now()+interval '5 minutes',
             reconciliation_attempts=0, updated_at=now()
           WHERE id=$5 RETURNING *`,
          [provider, providerReference, encryptDestination(destination), maskLast4(destination), existing.id]
        );
        escrow = retry;
      } else {
        const { rows: [created] } = await client.query(
          `INSERT INTO escrow_transactions
            (order_id, transaction_ref, buyer_user_id, seller_id, collection_provider,
             amount, currency, platform_fee, payout_amount, status, pending_operation,
             collection_reference, encrypted_collection_destination, collection_msisdn_last4,
             next_reconcile_at)
           VALUES ($1,$2,$3,$4,$5,$6,'ZMW',$7,$8,'INITIATED','COLLECTION',$9,$10,$11,now()+interval '5 minutes')
           RETURNING *`,
          [orderId, transactionRef, buyer.user_id, order.awarded_supplier_id, provider,
            amount, platformFee, payoutAmount, providerReference,
            encryptDestination(destination), maskLast4(destination)]
        );
        escrow = created;
      }
      const transitioned = await transitionEscrow(
        client, escrow, 'PAYMENT_PENDING', actorContext(buyer, correlationId, 'Buyer initiated checkout')
      );
      const { rows: [paymentLog] } = await client.query(
        `INSERT INTO payments_log (order_id, provider, provider_reference, amount, status, initiated_by)
         VALUES ($1,$2,$3,$4,'pending',$5) RETURNING id`,
        [orderId, provider.toLowerCase(), providerReference, amount, buyer.user_id]
      );
      await client.query('COMMIT');
      return { escrow: transitioned, paymentLogId: paymentLog.id, amount };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  const demo = process.env.DEMO_MODE === 'true' ||
    (process.env.NODE_ENV !== 'production' && String(destination) === '260000000000');
  if (demo) {
    await applyProviderOutcome({
      reference: providerReference, operation: 'collection', outcome: 'SUCCEEDED',
      raw: { status: 'SUCCESSFUL', demo: true }, correlationId,
    });
  } else {
    try {
      const response = await providers.collect(provider, {
        amount: result.amount,
        destination,
        orderId,
        reference: providerReference,
        description,
      });
      if (response.reference !== providerReference) {
        await pool.query(
          `UPDATE escrow_transactions SET collection_reference = $1, updated_at = now()
           WHERE transaction_ref = $2 AND status = 'PAYMENT_PENDING'`,
          [response.reference, transactionRef]
        );
        await pool.query('UPDATE payments_log SET provider_reference = $1 WHERE provider_reference = $2',
          [response.reference, providerReference]);
        providerReference = response.reference;
      }
    } catch (error) {
      if (/credentials? (are )?not configured/i.test(error.message)) {
        await pool.query(
          `UPDATE escrow_transactions SET failure_stage='COLLECTION_CONFIGURATION', failure_message=$1
           WHERE transaction_ref=$2`, [String(error.message).slice(0, 500), transactionRef]
        );
        await applyProviderOutcome({
          reference: providerReference,
          operation: 'collection',
          outcome: 'FAILED',
          raw: { status: 'FAILED', reason: 'PROVIDER_NOT_CONFIGURED' },
          correlationId,
          failureCode: 'PROVIDER_NOT_CONFIGURED',
          failureMessage: error.message,
        });
        error.status = 503;
        throw error;
      }
      // A timeout may occur after the provider accepted the transaction. Keep it
      // pending and let reconciliation determine the authoritative outcome.
      await pool.query(
        `UPDATE escrow_transactions SET failure_stage='COLLECTION_REQUEST', failure_message=$1,
         next_reconcile_at=now(), updated_at=now() WHERE transaction_ref=$2`,
        [String(error.message).slice(0, 500), transactionRef]
      );
      logger.warn('collection_request_uncertain', { transactionRef, provider, correlationId, message: error.message });
    }
  }
  return {
    paymentLogId: result.paymentLogId,
    escrowTransactionId: result.escrow.id,
    transactionRef,
    providerReference,
    status: 'PAYMENT_PENDING',
  };
}

async function applyProviderOutcome({ reference, operation, outcome, raw, correlationId, failureCode, failureMessage }) {
  return withFinancialLock(`provider-outcome:${reference}`, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const referenceColumn = operation === 'collection' ? 'collection_reference' : 'disbursement_reference';
      let { rows: [escrow] } = await client.query(
        `SELECT * FROM escrow_transactions
         WHERE ${referenceColumn} = $1 FOR UPDATE`, [reference]
      );
      if (!escrow) throw new Error('Escrow transaction was not found for provider reference');

      await client.query(
        `UPDATE escrow_transactions SET provider_response = provider_response || $1::jsonb,
           last_reconciled_at = now(), updated_at = now(),
           failure_code = COALESCE($2, failure_code), failure_message = COALESCE($3, failure_message)
         WHERE id = $4`,
        [JSON.stringify({ [operation]: safeProviderPayload(raw) }), failureCode || null,
          failureMessage ? String(failureMessage).slice(0, 500) : null, escrow.id]
      );

      if (outcome === 'PENDING') {
        await client.query(
          `UPDATE escrow_transactions SET reconciliation_attempts=reconciliation_attempts+1,
             next_reconcile_at=now()+interval '2 minutes' WHERE id=$1`, [escrow.id]
        );
        await client.query('COMMIT');
        return escrow.status;
      }

      let updated = escrow;
      if (outcome === 'SUCCEEDED' && escrow.status === 'FAILED') {
        const recoveryStatus = operation === 'collection' && escrow.failure_stage === 'COLLECTION'
          ? 'PAYMENT_PENDING'
          : operation === 'disbursement' && escrow.failure_stage === 'DISBURSEMENT'
            ? 'DISBURSEMENT_PENDING'
            : null;
        if (recoveryStatus) {
          escrow = await transitionEscrow(client, escrow, recoveryStatus, {
            actorType: 'provider', correlationId,
            reason: 'Provider reported success after an earlier terminal failure event',
          });
          updated = escrow;
        }
      }
      if (operation === 'collection' && outcome === 'SUCCEEDED' && escrow.status === 'PAYMENT_PENDING') {
        updated = await transitionEscrow(client, escrow, 'HELD_IN_ESCROW', {
          actorType: 'provider', correlationId, reason: 'Collection confirmed by payment provider',
        });
        const { rowCount } = await client.query(
          `INSERT INTO escrow_accounts
             (order_id, customer_user_id, amount, supplier_payout_amount, platform_fee_amount, subsidy_amount, status, funded_at)
           SELECT order_id, buyer_user_id, amount, payout_amount, platform_fee,
                  GREATEST(payout_amount + platform_fee - amount, 0), 'funded', now()
           FROM escrow_transactions WHERE id=$1
           ON CONFLICT (order_id) DO UPDATE SET status='funded', funded_at=now()
           WHERE escrow_accounts.status='pending_funding'`, [escrow.id]
        );
        await client.query(
          `UPDATE payments_log SET status='successful', provider_callback_payload=$1, updated_at=now()
           WHERE order_id=$2 AND status='pending'`, [JSON.stringify(safeProviderPayload(raw)), escrow.order_id]
        );
        if (rowCount) {
          await recordEscrowFunding(escrow.order_id, escrow.buyer_user_id, escrow.amount, client);
          const { rows: [order] } = await client.query('SELECT subsidy_amount FROM orders WHERE id=$1', [escrow.order_id]);
          await recordSubsidyFunding(escrow.order_id, escrow.buyer_user_id, order?.subsidy_amount, client);
        }
      } else if (operation === 'collection' && outcome === 'FAILED' && escrow.status === 'PAYMENT_PENDING') {
        await client.query("UPDATE escrow_transactions SET failure_stage='COLLECTION' WHERE id=$1", [escrow.id]);
        updated = await transitionEscrow(client, escrow, 'FAILED', {
          actorType: 'provider', correlationId, reason: 'Collection failed', metadata: { failureCode },
        });
        await client.query("UPDATE payments_log SET status='failed', updated_at=now() WHERE order_id=$1 AND status='pending'", [escrow.order_id]);
      } else if (operation === 'disbursement' && outcome === 'SUCCEEDED' && escrow.status === 'DISBURSEMENT_PENDING') {
        const target = escrow.pending_operation === 'REFUND' ? 'REFUNDED' : 'RELEASED';
        updated = await transitionEscrow(client, escrow, target, {
          actorType: 'provider', correlationId, reason: `${escrow.pending_operation} confirmed by payment provider`,
        });
        if (target === 'RELEASED') {
          await client.query("UPDATE escrow_accounts SET status='released', released_at=now() WHERE order_id=$1", [escrow.order_id]);
          const { rows: [order] } = await client.query('SELECT subsidy_amount FROM orders WHERE id=$1', [escrow.order_id]);
          await recordEscrowRelease(escrow.order_id, escrow.buyer_user_id, {
            gross: escrow.amount,
            supplierPayout: escrow.payout_amount,
            platformRevenue: escrow.platform_fee,
            subsidyAmount: order?.subsidy_amount || 0,
          }, client);
          await client.query("UPDATE orders SET status='completed' WHERE id=$1 AND status='disputed'", [escrow.order_id]);
          await client.query(
            `INSERT INTO payment_transactions (from_user_id, amount, payment_method, transaction_ref, type, status, gateway_response)
             VALUES ($1,$2,$3,$4,'payout','completed',$5) ON CONFLICT (transaction_ref) DO NOTHING`,
            [escrow.buyer_user_id, escrow.payout_amount,
              escrow.payout_provider === 'BANK' ? 'bank_transfer' : 'mobile_money', escrow.disbursement_reference,
              JSON.stringify(safeProviderPayload(raw))]
          );
        } else {
          await client.query("UPDATE escrow_accounts SET status='refunded' WHERE order_id=$1", [escrow.order_id]);
          const { rows: [order] } = await client.query('SELECT subsidy_amount FROM orders WHERE id=$1', [escrow.order_id]);
          await recordEscrowRefund(escrow.order_id, escrow.buyer_user_id, escrow.amount, order?.subsidy_amount || 0, client);
          await client.query(
            `INSERT INTO payment_transactions (from_user_id, to_user_id, amount, payment_method, transaction_ref, type, status, gateway_response)
             VALUES ($1,$1,$2,$3,$4,'refund','completed',$5) ON CONFLICT (transaction_ref) DO NOTHING`,
            [escrow.buyer_user_id, escrow.amount,
              escrow.collection_provider === 'BANK' ? 'bank_transfer' : 'mobile_money', escrow.disbursement_reference,
              JSON.stringify(safeProviderPayload(raw))]
          );
        }
      } else if (operation === 'disbursement' && outcome === 'FAILED' && escrow.status === 'DISBURSEMENT_PENDING') {
        await client.query("UPDATE escrow_transactions SET failure_stage='DISBURSEMENT' WHERE id=$1", [escrow.id]);
        updated = await transitionEscrow(client, escrow, 'FAILED', {
          actorType: 'provider', correlationId, reason: 'Disbursement failed', metadata: { failureCode },
        });
      }
      await client.query('COMMIT');
      logger.info('escrow_provider_outcome_applied', {
        transactionRef: escrow.transaction_ref, operation, outcome, status: updated.status, correlationId,
      });
      return updated.status;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

async function triggerDisbursement({ orderId, actor, correlationId, operation = 'RELEASE', reason }) {
  return withFinancialLock(`disbursement:${orderId}`, async () => {
    const client = await pool.connect();
    let prepared;
    try {
      await client.query('BEGIN');
      const { rows: [escrow] } = await client.query(
        `SELECT et.*, o.status AS order_status, b.tenant_id
         FROM escrow_transactions et JOIN orders o ON o.id=et.order_id JOIN bids b ON b.id=o.bid_id
         WHERE et.order_id=$1 FOR UPDATE OF et`, [orderId]
      );
      if (!escrow) throw Object.assign(new Error('Escrow transaction not found'), { status: 404 });
      const isAdmin = actor.user_type === 'platform_admin' && ['business_admin', 'system_admin'].includes(actor.role);
      const isBuyer = actor.user_type === 'tenant_user' && actor.role === 'customer' && actor.tenant_id === escrow.tenant_id;
      if (!isAdmin && !isBuyer) throw Object.assign(new Error('Buyer or admin authorization required'), { status: 403 });

      if (operation === 'RELEASE') {
        const resolvingDispute = isAdmin && escrow.status === 'DISPUTED' && Boolean(reason);
        if (escrow.status !== 'HELD_IN_ESCROW' && !resolvingDispute) {
          throw new Error(`Funds cannot be released from ${escrow.status}`);
        }
        if (!['delivered', 'completed'].includes(escrow.order_status) && !resolvingDispute) {
          throw new Error('Goods must be marked delivered before escrow can be released');
        }
        const { rows: [account] } = await client.query(
          `SELECT * FROM payout_accounts WHERE supplier_id=$1 AND is_primary=TRUE AND is_verified=TRUE
           ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`, [escrow.seller_id]
        );
        if (!account) throw Object.assign(new Error('Seller has no verified payout account'), { status: 422 });
        const reference = crypto.randomUUID();
        const { rows: [versioned] } = await client.query(
          `UPDATE escrow_transactions SET payout_provider=$1, payout_account_id=$2,
             disbursement_reference=$3, pending_operation='RELEASE', next_reconcile_at=now()+interval '5 minutes'
           WHERE id=$4 RETURNING *`, [account.provider, account.id, reference, escrow.id]
        );
        const transitioned = await transitionEscrow(client, versioned, 'DISBURSEMENT_PENDING',
          actorContext(actor, correlationId, reason || 'Goods receipt confirmed'));
        prepared = {
          escrow: transitioned, provider: account.provider,
          destination: decryptDestination(account.encrypted_destination), bankCode: account.bank_code,
          reference,
        };
      } else {
        if (!isAdmin) throw Object.assign(new Error('Only an admin can authorize a refund'), { status: 403 });
        if (!['HELD_IN_ESCROW', 'DISPUTED'].includes(escrow.status)) throw new Error(`Funds cannot be refunded from ${escrow.status}`);
        const reference = crypto.randomUUID();
        const versioned = await client.query(
          `UPDATE escrow_transactions SET payout_provider=collection_provider, disbursement_reference=$1,
             pending_operation='REFUND', next_reconcile_at=now()+interval '5 minutes' WHERE id=$2 RETURNING *`,
          [reference, escrow.id]
        ).then(r => r.rows[0]);
        const transitioned = await transitionEscrow(client, versioned, 'DISBURSEMENT_PENDING',
          actorContext(actor, correlationId, reason || 'Admin-authorized escrow refund'));
        prepared = {
          escrow: transitioned, provider: escrow.collection_provider,
          destination: decryptDestination(escrow.encrypted_collection_destination), reference,
        };
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    try {
      const response = await providers.disburse(prepared.provider, {
        amount: operation === 'RELEASE' ? prepared.escrow.payout_amount : prepared.escrow.amount,
        destination: prepared.destination,
        orderId,
        reference: prepared.reference,
        bankCode: prepared.bankCode,
        description: operation === 'RELEASE' ? 'ZedProcure supplier payout' : 'ZedProcure buyer refund',
      });
      if (response.reference !== prepared.reference) {
        await pool.query('UPDATE escrow_transactions SET disbursement_reference=$1 WHERE id=$2',
          [response.reference, prepared.escrow.id]);
      }
    } catch (error) {
      await pool.query(
        `UPDATE escrow_transactions SET failure_stage='DISBURSEMENT_REQUEST', failure_message=$1,
           next_reconcile_at=now(), updated_at=now() WHERE id=$2`,
        [String(error.message).slice(0, 500), prepared.escrow.id]
      );
      logger.warn('disbursement_request_uncertain', {
        orderId, provider: prepared.provider, operation, correlationId, message: error.message,
      });
    }
    return {
      escrowTransactionId: prepared.escrow.id,
      transactionRef: prepared.escrow.transaction_ref,
      providerReference: prepared.reference,
      status: 'DISBURSEMENT_PENDING',
      operation,
    };
  });
}

async function raiseDispute({ orderId, actor, reason, correlationId }) {
  return withFinancialLock(`dispute:${orderId}`, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [escrow] } = await client.query(
        `SELECT et.*, b.tenant_id FROM escrow_transactions et JOIN orders o ON o.id=et.order_id
         JOIN bids b ON b.id=o.bid_id WHERE et.order_id=$1 FOR UPDATE OF et`, [orderId]
      );
      if (!escrow) throw Object.assign(new Error('Escrow transaction not found'), { status: 404 });
      let authorized = actor.user_type === 'platform_admin' ||
        (actor.user_type === 'tenant_user' && actor.tenant_id === escrow.tenant_id);
      if (actor.user_type === 'supplier_user') {
        const { rows: [supplier] } = await client.query('SELECT supplier_id FROM supplier_users WHERE id=$1', [actor.user_id]);
        authorized = supplier?.supplier_id === escrow.seller_id;
      }
      if (!authorized) throw Object.assign(new Error('Buyer, seller, or admin authorization required'), { status: 403 });
      if (!['HELD_IN_ESCROW', 'DISBURSEMENT_PENDING'].includes(escrow.status)) throw new Error(`Cannot dispute escrow in ${escrow.status}`);
      const updated = await transitionEscrow(client, escrow, 'DISPUTED', actorContext(actor, correlationId, reason));
      await client.query("UPDATE orders SET status='disputed' WHERE id=$1 AND status <> 'completed'", [orderId]);
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

async function syncEscrowPaymentStatus(paymentLogId, correlationId) {
  const { rows: [transaction] } = await pool.query(
    `SELECT et.* FROM escrow_transactions et JOIN payments_log pl ON pl.order_id=et.order_id
     WHERE pl.id=$1`, [paymentLogId]
  );
  if (!transaction) return null;
  if (transaction.status === 'HELD_IN_ESCROW') return 'successful';
  if (['RELEASED', 'REFUNDED'].includes(transaction.status)) return 'successful';
  if (transaction.status === 'FAILED') return 'failed';
  if (transaction.status !== 'PAYMENT_PENDING') return 'pending';
  try {
    const result = await providers.queryTransaction(
      transaction.collection_provider, transaction.collection_reference, 'collection'
    );
    const state = await applyProviderOutcome({
      reference: transaction.collection_reference,
      operation: 'collection',
      outcome: result.status,
      raw: result.raw,
      correlationId,
    });
    if (state === 'HELD_IN_ESCROW') return 'successful';
    if (state === 'FAILED') return 'failed';
  } catch (error) {
    logger.warn('buyer_status_poll_failed', {
      paymentLogId, correlationId, message: error.message,
    });
  }
  return 'pending';
}

module.exports = {
  createCollection, applyProviderOutcome, triggerDisbursement, raiseDispute,
  syncEscrowPaymentStatus, money, maskLast4, safeProviderPayload,
};
