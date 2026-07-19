/**
 * Airtel Money (Collections) Service — Zambia (ZM)
 * Docs: https://developers.airtel.africa/documentation
 *
 * Environment variables required:
 *   AIRTEL_BASE_URL       - https://openapiuat.airtel.africa (sandbox) | https://openapi.airtel.africa (prod)
 *   AIRTEL_CLIENT_ID      - From developer portal app
 *   AIRTEL_CLIENT_SECRET  - From developer portal app
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const BASE_URL      = () => process.env.AIRTEL_BASE_URL || 'https://openapiuat.airtel.africa';
const CLIENT_ID     = () => process.env.AIRTEL_CLIENT_ID;
const CLIENT_SECRET = () => process.env.AIRTEL_CLIENT_SECRET;

// Simple in-memory token cache (token lasts ~1hr per Airtel spec)
let _tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (!CLIENT_ID() || !CLIENT_SECRET()) {
    throw new Error('Airtel Money credentials not configured. Set AIRTEL_CLIENT_ID and AIRTEL_CLIENT_SECRET.');
  }

  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token;
  }

  const { data } = await axios.post(
    `${BASE_URL()}/auth/oauth2/token`,
    {
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      grant_type: 'client_credentials',
    },
    { headers: { 'Content-Type': 'application/json' } }
  );

  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000 - 60000, // refresh 1 min early
  };
  return _tokenCache.token;
}

/**
 * Initiate a collection (debit customer's Airtel Money wallet).
 * @param {string} amount   ZMW amount
 * @param {string} msisdn   Airtel number e.g. "260977123456"
 * @param {string} orderId  Your internal reference
 * @returns {string}        transactionId to poll status with
 */
async function collect(amount, msisdn, orderId) {
  const token = await getAccessToken();
  const reference = uuidv4();

  const { data } = await axios.post(
    `${BASE_URL()}/merchant/v1/payments/`,
    {
      reference,
      subscriber: { country: 'ZM', currency: 'ZMW', msisdn },
      transaction: {
        amount: String(amount),
        country: 'ZM',
        currency: 'ZMW',
        id: orderId,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Country': 'ZM',
        'X-Currency': 'ZMW',
        'Content-Type': 'application/json',
      },
    }
  );

  // Airtel returns the transaction id inside data.data.transaction
  return data.data?.transaction?.id || reference;
}

/**
 * Check status of an Airtel Money transaction.
 * @param {string} transactionId
 * @returns {'TS'|'TF'|'TP'} TS=successful, TF=failed, TP=pending
 */
async function getStatus(transactionId) {
  const token = await getAccessToken();
  const { data } = await axios.get(
    `${BASE_URL()}/standard/v1/payments/${transactionId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Country': 'ZM',
        'X-Currency': 'ZMW',
      },
    }
  );
  return data.data?.transaction?.status;
}

module.exports = { collect, getStatus };
