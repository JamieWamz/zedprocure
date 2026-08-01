const axios = require('axios');
const { randomUUID } = require('crypto');

function configured() {
  return Boolean(process.env.BANK_API_BASE_URL && process.env.BANK_API_KEY);
}

function headers(idempotencyKey) {
  return {
    Authorization: `Bearer ${process.env.BANK_API_KEY}`,
    'Idempotency-Key': idempotencyKey,
    'Content-Type': 'application/json',
  };
}

async function call(path, body, reference) {
  if (!configured()) return { reference, status: 'PENDING_MANUAL_SETTLEMENT' };
  const { data } = await axios.post(`${process.env.BANK_API_BASE_URL}${path}`, body, {
    timeout: 15000,
    headers: headers(reference),
  });
  return { reference: data.reference || data.transaction_id || reference, status: data.status, raw: data };
}

async function collect(amount, account, orderId, reference = randomUUID()) {
  return call(process.env.BANK_COLLECTION_PATH || '/collections', {
    amount: String(amount), currency: 'ZMW', account, reference, order_id: orderId,
  }, reference);
}

async function disburse(amount, account, orderId, reference = randomUUID(), bankCode) {
  return call(process.env.BANK_DISBURSEMENT_PATH || '/disbursements', {
    amount: String(amount), currency: 'ZMW', account, bank_code: bankCode, reference, order_id: orderId,
  }, reference);
}

async function queryTransaction(reference, operation) {
  if (!configured()) return { reference, status: 'PENDING' };
  const template = process.env.BANK_STATUS_PATH || '/transactions/:id';
  const { data } = await axios.get(`${process.env.BANK_API_BASE_URL}${template.replace(':id', encodeURIComponent(reference))}`, {
    timeout: 15000,
    headers: headers(reference),
    params: { operation },
  });
  return data;
}

module.exports = { configured, collect, disburse, queryTransaction };
