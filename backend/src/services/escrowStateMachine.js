const ALLOWED_TRANSITIONS = Object.freeze({
  INITIATED: ['PAYMENT_PENDING', 'FAILED'],
  PAYMENT_PENDING: ['HELD_IN_ESCROW', 'FAILED'],
  HELD_IN_ESCROW: ['DISBURSEMENT_PENDING', 'DISPUTED', 'FAILED'],
  DISBURSEMENT_PENDING: ['RELEASED', 'REFUNDED', 'DISPUTED', 'FAILED'],
  DISPUTED: ['HELD_IN_ESCROW', 'DISBURSEMENT_PENDING', 'REFUNDED'],
  FAILED: ['PAYMENT_PENDING', 'DISBURSEMENT_PENDING'],
  RELEASED: [],
  REFUNDED: [],
});

class InvalidEscrowTransitionError extends Error {
  constructor(from, to) {
    super(`Escrow cannot transition from ${from} to ${to}`);
    this.code = 'INVALID_ESCROW_TRANSITION';
  }
}

function canTransition(from, to) {
  return Boolean(ALLOWED_TRANSITIONS[from]?.includes(to));
}

async function transitionEscrow(client, escrow, toStatus, context) {
  if (escrow.status === toStatus) return escrow;
  if (!canTransition(escrow.status, toStatus)) throw new InvalidEscrowTransitionError(escrow.status, toStatus);

  const timestampColumn = {
    PAYMENT_PENDING: 'collection_requested_at',
    HELD_IN_ESCROW: 'held_at',
    DISBURSEMENT_PENDING: 'disbursement_requested_at',
    RELEASED: 'released_at',
    DISPUTED: 'disputed_at',
    REFUNDED: 'refunded_at',
    FAILED: 'failed_at',
  }[toStatus];
  const timestampSql = timestampColumn ? `, ${timestampColumn} = now()` : '';
  const { rows: [updated] } = await client.query(
    `UPDATE escrow_transactions
     SET status = $1, updated_at = now(), version = version + 1${timestampSql}
     WHERE id = $2 AND version = $3 RETURNING *`,
    [toStatus, escrow.id, escrow.version]
  );
  if (!updated) throw new Error('Escrow was concurrently modified');

  await client.query('UPDATE orders SET escrow_state = $1 WHERE id = $2', [toStatus, escrow.order_id]);
  await client.query(
    `INSERT INTO escrow_state_transitions
       (escrow_transaction_id, from_status, to_status, actor_id, actor_type, reason, correlation_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [escrow.id, escrow.status, toStatus, context.actorId || null, context.actorType || 'system',
      context.reason || null, context.correlationId, JSON.stringify(context.metadata || {})]
  );
  return updated;
}

module.exports = { ALLOWED_TRANSITIONS, canTransition, transitionEscrow, InvalidEscrowTransitionError };
