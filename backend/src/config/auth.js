require('dotenv').config();

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  // In production a missing secret must be fatal: otherwise tokens can be forged.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET is not set. Refusing to start in production.');
  }
  console.warn('WARNING: JWT_SECRET is not set. Using an ephemeral secret (tokens invalid after restart). Set JWT_SECRET for production.');
}

// Cookies must NOT be Secure over plain HTTP (e.g. LAN access). Enable only behind TLS.
const cookieSecure = process.env.COOKIE_SECURE === 'true';

const isProd = process.env.NODE_ENV === 'production';

const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TTL = process.env.JWT_REFRESH_TTL || '7d';

const cookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: process.env.COOKIE_SAMESITE || 'lax',
  path: '/',
};

const TOKEN_COOKIE = 'token';
const REFRESH_COOKIE = 'refresh_token';

module.exports = {
  jwtSecret,
  ACCESS_TTL,
  REFRESH_TTL,
  cookieOptions,
  isProd,
  cookieSecure,
  TOKEN_COOKIE,
  REFRESH_COOKIE,
};
