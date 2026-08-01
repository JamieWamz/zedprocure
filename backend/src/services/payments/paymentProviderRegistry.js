const crypto = require('crypto');
const mtn = require('./mtnMomoService');
const airtel = require('./airtelMoneyService');
const bank = require('./bankPaymentService');

const PROVIDERS = Object.freeze(['MTN', 'AIRTEL', 'BANK']);

function normalizeProvider(value) {
  const provider = String(value || '').trim().toUpperCase();
  if (!PROVIDERS.includes(provider)) throw new Error(`Unsupported payment provider: ${value}`);
  return provider;
}

async function collect(providerValue, params) {
  const provider = normalizeProvider(providerValue);
  if (provider === 'MTN') {
    return { reference: await mtn.requestToPay(params.amount, params.destination, params.orderId, params.description, params.reference) };
  }
  if (provider === 'AIRTEL') {
    return { reference: await airtel.pay(params.amount, params.destination, params.orderId, params.reference) };
  }
  return bank.collect(params.amount, params.destination, params.orderId, params.reference);
}

async function disburse(providerValue, params) {
  const provider = normalizeProvider(providerValue);
  if (provider === 'MTN') {
    return { reference: await mtn.transfer(params.amount, params.destination, params.orderId, params.reference, params.description) };
  }
  if (provider === 'AIRTEL') {
    return { reference: await airtel.disburse(params.amount, params.destination, params.orderId, params.reference) };
  }
  return bank.disburse(params.amount, params.destination, params.orderId, params.reference, params.bankCode);
}

function normalizeStatus(provider, raw) {
  const value = String(
    raw?.status || raw?.data?.transaction?.status || raw?.transaction?.status || ''
  ).toUpperCase();
  if (['SUCCESSFUL', 'SUCCESS', 'SUCCEEDED', 'TS', 'COMPLETED', 'PAID'].includes(value)) return 'SUCCEEDED';
  if (['FAILED', 'FAILURE', 'TF', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(value)) return 'FAILED';
  return 'PENDING';
}

async function queryTransaction(providerValue, reference, operation) {
  const provider = normalizeProvider(providerValue);
  let raw;
  if (provider === 'MTN') raw = await mtn.getTransactionStatus(reference, operation);
  else if (provider === 'AIRTEL') raw = await airtel.queryTransaction(reference, operation);
  else raw = await bank.queryTransaction(reference, operation);
  return { status: normalizeStatus(provider, raw), raw };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyWebhook(providerValue, rawBody, headers) {
  const provider = normalizeProvider(providerValue);
  const token = process.env[`${provider}_WEBHOOK_TOKEN`];
  const secret = process.env[`${provider}_WEBHOOK_SECRET`];
  if (!token && !secret) throw new Error(`${provider} webhook verification is not configured`);

  const authorization = String(headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token && safeEqual(authorization, token)) return true;

  const supplied = String(headers['x-webhook-signature'] || headers['x-signature'] || '')
    .replace(/^sha256=/i, '');
  if (secret && /^[a-f0-9]{64}$/i.test(supplied)) {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (safeEqual(supplied.toLowerCase(), expected)) return true;
  }
  return false;
}

function normalizeWebhook(providerValue, payload, headers = {}) {
  const provider = normalizeProvider(providerValue);
  const transaction = payload.transaction || payload.data?.transaction || {};
  const reference = String(
    payload.referenceId || payload.reference || payload.externalId ||
    transaction.id || payload.transactionId || ''
  );
  if (!reference || reference.length > 128) throw new Error('Webhook transaction reference is missing or invalid');

  const operationHint = String(
    headers['x-payment-operation'] || payload.operation || payload.type || payload.event_type || ''
  ).toUpperCase();
  const operation = /DISBURS|TRANSFER|PAYOUT|REFUND/.test(operationHint) ? 'disbursement' : 'collection';
  return {
    reference,
    operation,
    status: normalizeStatus(provider, payload),
    eventType: operationHint || `${operation.toUpperCase()}_STATUS`,
    failureCode: payload.reason?.code || payload.code || transaction.message || null,
    failureMessage: payload.reason?.message || payload.message || null,
  };
}

function webhookIdempotencyKey(providerValue, payload, headers, rawBody) {
  const provider = normalizeProvider(providerValue);
  const explicit = headers['x-idempotency-key'] || headers['x-event-id'] ||
    payload.eventId || payload.id || payload.transaction?.id || payload.data?.transaction?.id;
  const digest = crypto.createHash('sha256').update(rawBody).digest('hex');
  return String(explicit ? `${explicit}:${digest.slice(0, 20)}` : digest).slice(0, 160);
}

module.exports = {
  PROVIDERS, normalizeProvider, collect, disburse, queryTransaction,
  verifyWebhook, normalizeWebhook, webhookIdempotencyKey, normalizeStatus,
};
