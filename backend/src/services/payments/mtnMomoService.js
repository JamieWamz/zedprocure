/**
 * MTN Mobile Money (Collections) Service
 * Docs: https://momodeveloper.mtn.com/api-documentation/collection/
 *
 * Environment variables required:
 *   MTN_MOMO_BASE_URL         - https://sandbox.momodeveloper.mtn.com (or production URL)
 *   MTN_MOMO_SUBSCRIPTION_KEY - Primary subscription key from developer portal
 *   MTN_MOMO_API_USER         - UUID you registered as API user
 *   MTN_MOMO_API_KEY          - Key generated for that API user
 *   MTN_MOMO_ENV              - 'sandbox' | 'production'
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const BASE_URL         = () => process.env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const SUBSCRIPTION_KEY = () => process.env.MTN_MOMO_SUBSCRIPTION_KEY;
const API_USER         = () => process.env.MTN_MOMO_API_USER;
const API_KEY          = () => process.env.MTN_MOMO_API_KEY;
const ENV              = () => process.env.MTN_MOMO_ENV || 'sandbox';

/** Fetch a fresh OAuth2 bearer token for the Collections product */
async function getAccessToken() {
  const credentials = Buffer.from(`${API_USER()}:${API_KEY()}`).toString('base64');
  const { data } = await axios.post(
    `${BASE_URL()}/collection/token/`,
    {},
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY(),
      },
    }
  );
  return data.access_token;
}

/**
 * Request to pay — pull funds from the customer's MTN wallet.
 * @param {string} amount      ZMW amount (e.g. "1500.00")
 * @param {string} msisdn      Customer MTN number (e.g. "260971234567")
 * @param {string} orderId     Your internal order reference
 * @param {string} description Short message shown on the customer's phone
 * @returns {string}           externalId — store this to poll status
 */
async function requestToPay(amount, msisdn, orderId, description = 'ZedProcure Payment') {
  if (!SUBSCRIPTION_KEY() || !API_USER() || !API_KEY()) {
    throw new Error('MTN MoMo credentials not configured. Set MTN_MOMO_* environment variables.');
  }

  const token = await getAccessToken();
  const externalId = uuidv4();

  await axios.post(
    `${BASE_URL()}/collection/v1_0/requesttopay`,
    {
      amount: String(amount),
      currency: 'ZMW',
      externalId,
      payer: { partyIdType: 'MSISDN', partyId: msisdn },
      payerMessage: description,
      payeeNote: `ZedProcure Ref: ${orderId}`,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': externalId,
        'X-Target-Environment': ENV(),
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY(),
        'Content-Type': 'application/json',
      },
    }
  );

  return externalId;
}

/**
 * Poll status of a request-to-pay.
 * @param {string} externalId   UUID returned by requestToPay
 * @returns {'PENDING'|'SUCCESSFUL'|'FAILED'}
 */
async function getPaymentStatus(externalId) {
  const token = await getAccessToken();
  const { data } = await axios.get(
    `${BASE_URL()}/collection/v1_0/requesttopay/${externalId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': ENV(),
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY(),
      },
    }
  );
  return data.status; // 'PENDING' | 'SUCCESSFUL' | 'FAILED'
}

module.exports = { requestToPay, getPaymentStatus };
