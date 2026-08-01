const axios = require('axios');
const { randomUUID } = require('crypto');

const BASE_URL = () => process.env.AIRTEL_BASE_URL || 'https://openapiuat.airtel.africa';
const COUNTRY = () => process.env.AIRTEL_COUNTRY || 'ZM';
const CURRENCY = () => process.env.AIRTEL_CURRENCY || 'ZMW';
let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (!process.env.AIRTEL_CLIENT_ID || !process.env.AIRTEL_CLIENT_SECRET) {
    throw new Error('Airtel Money credentials are not configured');
  }
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const { data } = await axios.post(`${BASE_URL()}/auth/oauth2/token`, {
    client_id: process.env.AIRTEL_CLIENT_ID,
    client_secret: process.env.AIRTEL_CLIENT_SECRET,
    grant_type: 'client_credentials',
  }, { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000,
  };
  return tokenCache.token;
}

async function headers() {
  return {
    Authorization: `Bearer ${await getAccessToken()}`,
    'X-Country': COUNTRY(),
    'X-Currency': CURRENCY(),
    'Content-Type': 'application/json',
  };
}

async function pay(amount, msisdn, orderId, transactionId = randomUUID()) {
  const { data } = await axios.post(`${BASE_URL()}${process.env.AIRTEL_COLLECTION_PATH || '/merchant/v1/payments/'}`, {
    reference: `ZedProcure order ${orderId}`,
    subscriber: { country: COUNTRY(), currency: CURRENCY(), msisdn },
    transaction: { amount: String(amount), country: COUNTRY(), currency: CURRENCY(), id: transactionId },
  }, { timeout: 15000, headers: await headers() });
  return data.data?.transaction?.id || transactionId;
}

async function disburse(amount, msisdn, orderId, transactionId = randomUUID()) {
  if (!process.env.AIRTEL_DISBURSEMENT_PIN) {
    throw new Error('Airtel Money disbursement credentials are not configured');
  }
  const path = process.env.AIRTEL_DISBURSEMENT_PATH || '/standard/v1/disbursements/';
  const { data } = await axios.post(`${BASE_URL()}${path}`, {
    payee: { msisdn },
    reference: `ZedProcure order ${orderId}`,
    pin: process.env.AIRTEL_DISBURSEMENT_PIN,
    transaction: { amount: String(amount), id: transactionId },
  }, { timeout: 15000, headers: await headers() });
  return data.data?.transaction?.id || transactionId;
}

async function queryTransaction(transactionId, operation = 'collection') {
  const template = operation === 'collection'
    ? (process.env.AIRTEL_COLLECTION_STATUS_PATH || '/standard/v1/payments/:id')
    : (process.env.AIRTEL_DISBURSEMENT_STATUS_PATH || '/standard/v1/disbursements/:id');
  const path = template.replace(':id', encodeURIComponent(transactionId));
  const { data } = await axios.get(`${BASE_URL()}${path}`, { timeout: 15000, headers: await headers() });
  return data;
}

async function collect(amount, msisdn, orderId, transactionId) {
  return pay(amount, msisdn, orderId, transactionId);
}

async function getStatus(transactionId) {
  const data = await queryTransaction(transactionId, 'collection');
  return data.data?.transaction?.status;
}

module.exports = { getAccessToken, pay, collect, disburse, queryTransaction, getStatus };
