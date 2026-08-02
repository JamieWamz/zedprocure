const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDENTITY_USER_TYPES = new Set([
  'platform_admin',
  'tenant_user',
  'supplier_user',
]);

class IdentityEmailValidationError extends Error {
  constructor(message = 'A valid email address is required') {
    super(message);
    this.name = 'IdentityEmailValidationError';
    this.statusCode = 400;
  }
}

class IdentityEmailConflictError extends Error {
  constructor() {
    super('An account with this email already exists');
    this.name = 'IdentityEmailConflictError';
    this.statusCode = 409;
  }
}

function normalizeIdentityEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function requireValidIdentityEmail(value) {
  const email = normalizeIdentityEmail(value);
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new IdentityEmailValidationError();
  }
  return email;
}

async function lockIdentityEmails(client, emails) {
  const normalizedEmails = [...new Set(
    emails.map(normalizeIdentityEmail).filter(Boolean)
  )].sort();

  for (const email of normalizedEmails) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
  }
  return normalizedEmails;
}

async function assertIdentityEmailAvailable(client, value, {
  userType,
  id,
  lockEmails = [],
} = {}) {
  const email = requireValidIdentityEmail(value);
  const hasUserType = userType !== undefined;
  const hasId = id !== undefined;
  if (hasUserType !== hasId) {
    throw new TypeError('Email uniqueness exclusion requires both userType and id');
  }
  if (hasUserType && !IDENTITY_USER_TYPES.has(userType)) {
    throw new TypeError('Email uniqueness exclusion has an invalid userType');
  }

  await lockIdentityEmails(client, [...lockEmails, email]);

  const exclusionClause = hasUserType
    ? 'AND (candidate.user_type <> $2 OR candidate.id <> $3)'
    : '';
  const params = hasUserType ? [email, userType, id] : [email];
  const { rows } = await client.query(
    `SELECT candidate.user_type, candidate.id
     FROM (
       SELECT 'platform_admin'::text AS user_type, id, email FROM platform_admins
       UNION ALL
       SELECT 'tenant_user'::text AS user_type, id, email FROM tenant_users
       UNION ALL
       SELECT 'supplier_user'::text AS user_type, id, email FROM supplier_users
     ) candidate
     WHERE LOWER(BTRIM(candidate.email)) = $1
       ${exclusionClause}
     LIMIT 1`,
    params
  );

  if (rows.length > 0) throw new IdentityEmailConflictError();
  return email;
}

module.exports = {
  IdentityEmailConflictError,
  IdentityEmailValidationError,
  assertIdentityEmailAvailable,
  lockIdentityEmails,
  normalizeIdentityEmail,
  requireValidIdentityEmail,
};
