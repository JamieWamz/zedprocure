/**
 * Zamtel Kwacha Mobile Money Service
 *
 * Zamtel does not have a public self-service developer portal.
 * Contact enterprise@zamtel.co.zm or your account manager to receive:
 *   - API base URL
 *   - Merchant ID
 *   - API Key / credentials
 *
 * Environment variables required:
 *   ZAMTEL_BASE_URL      - Provided by Zamtel enterprise team
 *   ZAMTEL_MERCHANT_ID   - Your merchant identifier
 *   ZAMTEL_API_KEY       - Your API key
 *
 * This service acts as a thin wrapper that normalises Zamtel's responses
 * to the same interface used by MTN and Airtel services.
 */

const axios = require('axios');

const BASE_URL    = () => process.env.ZAMTEL_BASE_URL;
const MERCHANT_ID = () => process.env.ZAMTEL_MERCHANT_ID;
const API_KEY     = () => process.env.ZAMTEL_API_KEY;

function checkConfig() {
  if (!BASE_URL() || !MERCHANT_ID() || !API_KEY()) {
    throw new Error(
      'Zamtel Kwacha credentials not configured. ' +
      'Contact enterprise@zamtel.co.zm and set ZAMTEL_BASE_URL, ZAMTEL_MERCHANT_ID, ZAMTEL_API_KEY.'
    );
  }
}

/**
 * Initiate a Zamtel Kwacha payment request (pull from customer wallet).
 * @param {string} amount   ZMW amount
 * @param {string} msisdn   Zamtel number e.g. "260963123456"
 * @param {string} orderId  Your internal reference
 * @returns {string}        transactionId to poll status with
 */
async function requestPayment(amount, msisdn, orderId) {
  checkConfig();
  const { data } = await axios.post(
    `${BASE_URL()}/payment/request`,
    {
      merchantId: MERCHANT_ID(),
      amount: String(amount),
      currency: 'ZMW',
      msisdn,
      reference: orderId,
      narration: `ZedProcure Order ${orderId}`,
    },
    {
      headers: {
        'X-Api-Key': API_KEY(),
        'Content-Type': 'application/json',
      },
    }
  );

  return data.transactionId;
}

/**
 * Query status of a Zamtel transaction.
 * @param {string} transactionId
 * @returns {'PENDING'|'SUCCESSFUL'|'FAILED'}
 */
async function getStatus(transactionId) {
  checkConfig();
  const { data } = await axios.get(
    `${BASE_URL()}/payment/status/${transactionId}`,
    {
      headers: { 'X-Api-Key': API_KEY() },
    }
  );
  // Normalise to a consistent status string
  const raw = (data.status || '').toUpperCase();
  if (raw === 'SUCCESS' || raw === 'SUCCESSFUL' || raw === 'COMPLETED') return 'SUCCESSFUL';
  if (raw === 'FAILED'  || raw === 'FAILURE'   || raw === 'REJECTED')  return 'FAILED';
  return 'PENDING';
}

module.exports = { requestPayment, getStatus };
