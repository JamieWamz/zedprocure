const { randomUUID } = require('crypto');
const {
  ALLOWED_TRANSITIONS, canTransition, transitionEscrow, InvalidEscrowTransitionError,
} = require('../services/escrowStateMachine');

describe('escrow state machine', () => {
  test.each([
    ['INITIATED', 'PAYMENT_PENDING'],
    ['PAYMENT_PENDING', 'HELD_IN_ESCROW'],
    ['HELD_IN_ESCROW', 'DISBURSEMENT_PENDING'],
    ['HELD_IN_ESCROW', 'DISPUTED'],
    ['DISBURSEMENT_PENDING', 'RELEASED'],
    ['DISBURSEMENT_PENDING', 'REFUNDED'],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  test.each([
    ['INITIATED', 'RELEASED'],
    ['PAYMENT_PENDING', 'RELEASED'],
    ['RELEASED', 'REFUNDED'],
    ['REFUNDED', 'DISBURSEMENT_PENDING'],
  ])('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  test('atomically updates escrow, order projection, and transition audit', async () => {
    const escrow = { id: randomUUID(), order_id: randomUUID(), status: 'PAYMENT_PENDING', version: 3 };
    const updated = { ...escrow, status: 'HELD_IN_ESCROW', version: 4 };
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [updated] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    await expect(transitionEscrow(client, escrow, 'HELD_IN_ESCROW', {
      correlationId: randomUUID(), actorType: 'provider',
    })).resolves.toEqual(updated);
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.query.mock.calls[0][0]).toContain('version = version + 1');
    expect(client.query.mock.calls[1][0]).toContain('UPDATE orders SET escrow_state');
    expect(client.query.mock.calls[2][0]).toContain('INSERT INTO escrow_state_transitions');
  });

  test('throws a typed error for an illegal transition', async () => {
    const client = { query: jest.fn() };
    await expect(transitionEscrow(client, {
      id: randomUUID(), order_id: randomUUID(), status: 'RELEASED', version: 1,
    }, 'REFUNDED', { correlationId: randomUUID() })).rejects.toBeInstanceOf(InvalidEscrowTransitionError);
    expect(client.query).not.toHaveBeenCalled();
  });

  test('terminal states have no outbound transitions', () => {
    expect(ALLOWED_TRANSITIONS.RELEASED).toEqual([]);
    expect(ALLOWED_TRANSITIONS.REFUNDED).toEqual([]);
  });
});
