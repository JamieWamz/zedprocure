const axios = require('axios');
const { randomUUID } = require('crypto');

const BASE_URL = () => process.env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const TARGET_ENV = () => process.env.MTN_MOMO_ENV || 'sandbox';
const CALLBACK_BASE = () => process.env.PAYMENT_CALLBACK_BASE_URL;
const tokenCache = new Map();

function credentials(product) {
  const prefix = product === 'collection' ? 'COLLECTION' : 'DISBURSEMENT';
  return {
    subscriptionKey: process.env[`MTN_MOMO_${prefix}_SUBSCRIPTION_KEY`] ||
      (product === 'collection' ? process.env.MTN_MOMO_SUBSCRIPTION_KEY : undefined),
    apiUser: process.env[`MTN_MOMO_${prefix}_API_USER`] ||
      (product === 'collection' ? process.env.MTN_MOMO_API_USER : undefined),
    apiKey: process.env[`MTN_MOMO_${prefix}_API_KEY`] ||
      (product === 'collection' ? process.env.MTN_MOMO_API_KEY : undefined),
  };
}

function requireCredentials(product) {
  const creds = credentials(product);
  if (!creds.subscriptionKey || !creds.apiUser || !creds.apiKey) {
    throw new Error(`MTN MoMo ${product} credentials are not configured`);
  }
  return creds;
}

async function getAccessToken(product = 'collection') {
  const cached = tokenCache.get(product);
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const creds = requireCredentials(product);
  const auth = Buffer.from(`${creds.apiUser}:${creds.apiKey}`).toString('base64');
  const { data } = await axios.post(`${BASE_URL()}/${product}/token/`, null, {
    timeout: 15000,
    headers: {
      Authorization: `Basic ${auth}`,
      'Ocp-Apim-Subscription-Key': creds.subscriptionKey,
    },
  });
  tokenCache.set(product, {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000,
  });
  return data.access_token;
}

async function headers(product, referenceId) {
  const creds = requireCredentials(product);
  return {
    Authorization: `Bearer ${await getAccessToken(product)}`,
    'X-Target-Environment': TARGET_ENV(),
    'Ocp-Apim-Subscription-Key': creds.subscriptionKey,
    ...(referenceId ? { 'X-Reference-Id': referenceId } : {}),
    'Content-Type': 'application/json',
  };
}

async function requestToPay(amount, msisdn, orderId, description = 'ZedProcure Payment', referenceId = randomUUID()) {
  await axios.post(`${BASE_URL()}/collection/v1_0/requesttopay`, {
    amount: String(amount),
    currency: 'ZMW',
    externalId: referenceId,
    payer: { partyIdType: 'MSISDN', partyId: msisdn },
    payerMessage: description,
    payeeNote: `ZedProcure order ${orderId}`,
  }, {
    timeout: 15000,
    headers: {
      ...(await headers('collection', referenceId)),
      ...(CALLBACK_BASE() ? { 'X-Callback-Url': `${CALLBACK_BASE().replace(/\/$/, '')}/api/webhooks/mtn` } : {}),
    },
  });
  return referenceId;
}

async function transfer(amount, msisdn, orderId, referenceId = randomUUID(), message = 'ZedProcure supplier payout') {
  await axios.post(`${BASE_URL()}/disbursement/v1_0/transfer`, {
    amount: String(amount),
    currency: 'ZMW',
    externalId: referenceId,
    payee: { partyIdType: 'MSISDN', partyId: msisdn },
    payerMessage: message,
    payeeNote: `ZedProcure order ${orderId}`,
  }, {
    timeout: 15000,
    headers: {
      ...(await headers('disbursement', referenceId)),
      ...(CALLBACK_BASE() ? { 'X-Callback-Url': `${CALLBACK_BASE().replace(/\/$/, '')}/api/webhooks/mtn` } : {}),
    },
  });
  return referenceId;
}

async function getTransactionStatus(referenceId, operation = 'collection') {
  const product = operation === 'collection' ? 'collection' : 'disbursement';
  const resource = operation === 'collection' ? 'requesttopay' : 'transfer';
  const { data } = await axios.get(`${BASE_URL()}/${product}/v1_0/${resource}/${encodeURIComponent(referenceId)}`, {
    timeout: 15000,
    headers: await headers(product),
  });
  return data;
}

async function getPaymentStatus(referenceId) {
  return (await getTransactionStatus(referenceId, 'collection')).status;
}

module.exports = { getAccessToken, requestToPay, transfer, getTransactionStatus, getPaymentStatus };
