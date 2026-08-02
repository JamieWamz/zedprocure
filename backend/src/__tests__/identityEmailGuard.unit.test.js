const {
  IdentityEmailConflictError,
  assertIdentityEmailAvailable,
  normalizeIdentityEmail,
  requireValidIdentityEmail,
} = require('../services/identityEmailGuard');

const USER_ID = '00000000-0000-4000-8000-000000000001';

function makeClient(existing = []) {
  return {
    query: jest.fn(async sql => (
      sql.includes('SELECT candidate.user_type')
        ? { rows: existing }
        : { rows: [] }
    )),
  };
}

describe('identity email guard', () => {
  test('normalizes and validates identity emails consistently', () => {
    expect(normalizeIdentityEmail('  USER@Example.COM ')).toBe('user@example.com');
    expect(requireValidIdentityEmail('  USER@Example.COM ')).toBe('user@example.com');
    expect(() => requireValidIdentityEmail('not-an-email')).toThrow('A valid email address is required');
    expect(() => requireValidIdentityEmail('a'.repeat(250) + '@x.com'))
      .toThrow('A valid email address is required');
  });

  test('deduplicates and locks normalized emails in deterministic order', async () => {
    const client = makeClient();

    const email = await assertIdentityEmailAvailable(client, ' Z@EXAMPLE.COM ', {
      lockEmails: ['z@example.com', ' A@example.com ', 'a@example.com'],
    });

    expect(email).toBe('z@example.com');
    const lockCalls = client.query.mock.calls
      .filter(([sql]) => sql.includes('pg_advisory_xact_lock'));
    expect(lockCalls.map(([, params]) => params[0])).toEqual([
      'a@example.com',
      'z@example.com',
    ]);
  });

  test('applies a fixed user-type and id exclusion for identity updates', async () => {
    const client = makeClient();

    await assertIdentityEmailAvailable(client, 'user@example.com', {
      userType: 'tenant_user',
      id: USER_ID,
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('candidate.user_type <> $2 OR candidate.id <> $3'),
      ['user@example.com', 'tenant_user', USER_ID]
    );
  });

  test('raises a typed conflict when any identity table owns the email', async () => {
    const client = makeClient([{ user_type: 'supplier_user', id: USER_ID }]);

    await expect(assertIdentityEmailAvailable(client, 'user@example.com'))
      .rejects.toBeInstanceOf(IdentityEmailConflictError);
  });

  test('rejects incomplete or unrecognized exclusions before querying identities', async () => {
    const client = makeClient();

    await expect(assertIdentityEmailAvailable(client, 'user@example.com', {
      userType: 'tenant_user',
    })).rejects.toThrow(/both userType and id/);
    await expect(assertIdentityEmailAvailable(client, 'user@example.com', {
      userType: 'customer',
      id: USER_ID,
    })).rejects.toThrow(/invalid userType/);
  });
});
