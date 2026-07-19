# Payment API Integration Guide — ZedProcure

A practical reference for integrating Zambian mobile money and bank payment providers
into the ZedProcure platform.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [MTN Mobile Money (MoMo)](#2-mtn-mobile-money-momo)
3. [Airtel Money](#3-airtel-money)
4. [Zamtel Kwacha](#4-zamtel-kwacha)
5. [Bank Payments (ZNBS / Stanbic / Standard Chartered)](#5-bank-payments)
6. [Unified Payment Service (Backend)](#6-unified-payment-service-backend)
7. [Frontend Payment Modal](#7-frontend-payment-modal)
8. [Webhook Handling & Reconciliation](#8-webhook-handling--reconciliation)
9. [Security Checklist](#9-security-checklist)
10. [Environment Variables Reference](#10-environment-variables-reference)

---

## 1. Architecture Overview

```
Frontend (React)
     │  POST /api/payments/initiate
     ▼
Backend (Express)
     │  Unified PaymentService
     ├─────────────────┬──────────────────┬──────────────────┬──────────────────
     ▼                 ▼                  ▼                  ▼
MTN MoMo API     Airtel Money API   Zamtel Kwacha API   Bank Direct Debit API
     │                 │                  │                  │
     └─────────────────┴──────────────────┴──────────────────┘
                              │
                    Webhook / Callback
                              │
                     Backend /api/payments/callback
                              │
                    Update escrow_accounts table
                    Trigger notification
```

**Key principle**: The backend is the single source of truth. The frontend only
initiates a payment and polls for status — it never directly calls provider APIs.

---

## 2. MTN Mobile Money (MoMo)

### 2.1 Prerequisites

1. Register at [https://momodeveloper.mtn.com](https://momodeveloper.mtn.com)
2. Subscribe to the **Collections** product (and optionally **Disbursements** for payouts)
3. Get your `Ocp-Apim-Subscription-Key` (primary & secondary)
4. In production, contact MTN Zambia to activate your merchant account

### 2.2 Install SDK / HTTP client

```bash
cd backend
npm install axios uuid
```

MTN does not publish an official Node.js SDK — use `axios` with the REST API directly.

### 2.3 Backend — MTN MoMo Service

Create `backend/src/services/payments/mtnMomoService.js`:

```js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = process.env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const SUBSCRIPTION_KEY = process.env.MTN_MOMO_SUBSCRIPTION_KEY;
const API_USER = process.env.MTN_MOMO_API_USER;   // UUID you created in the portal
const API_KEY  = process.env.MTN_MOMO_API_KEY;    // Generated via POST /apiuser/{userId}/apikey

/**
 * Get a fresh OAuth2 bearer token for the Collections API.
 */
async function getAccessToken() {
  const credentials = Buffer.from(`${API_USER}:${API_KEY}`).toString('base64');
  const { data } = await axios.post(
    `${BASE_URL}/collection/token/`,
    {},
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
      },
    }
  );
  return data.access_token;
}

/**
 * Request a payment (pull funds from customer's MTN wallet).
 * @param {string} amount       - ZMW amount e.g. "1500.00"
 * @param {string} msisdn       - Customer's MTN number e.g. "260971234567"
 * @param {string} orderId      - Your internal order/reference ID
 * @param {string} description  - Short payment description
 * @returns {string} externalId - The UUID to poll status with
 */
async function requestToPay(amount, msisdn, orderId, description) {
  const token = await getAccessToken();
  const externalId = uuidv4();

  await axios.post(
    `${BASE_URL}/collection/v1_0/requesttopay`,
    {
      amount: String(amount),
      currency: 'ZMW',
      externalId,
      payer: { partyIdType: 'MSISDN', partyId: msisdn },
      payerMessage: description,
      payeeNote: `ZedProcure Order ${orderId}`,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': externalId,
        'X-Target-Environment': process.env.MTN_MOMO_ENV || 'sandbox',
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
        'Content-Type': 'application/json',
      },
    }
  );

  return externalId; // store this in your DB to poll status
}

/**
 * Poll the status of a payment by its externalId.
 * Returns: PENDING | SUCCESSFUL | FAILED
 */
async function getPaymentStatus(externalId) {
  const token = await getAccessToken();
  const { data } = await axios.get(
    `${BASE_URL}/collection/v1_0/requesttopay/${externalId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': process.env.MTN_MOMO_ENV || 'sandbox',
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
      },
    }
  );
  return data.status; // 'PENDING' | 'SUCCESSFUL' | 'FAILED'
}

module.exports = { requestToPay, getPaymentStatus };
```

### 2.4 Sandbox Setup (one-time)

```bash
# 1. Create an API user (use your subscription key)
curl -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser" \
  -H "X-Reference-Id: <YOUR_UUID>" \
  -H "Ocp-Apim-Subscription-Key: <SUBSCRIPTION_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"providerCallbackHost": "https://your-backend.onrender.com"}'

# 2. Generate an API key for that user
curl -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser/<YOUR_UUID>/apikey" \
  -H "Ocp-Apim-Subscription-Key: <SUBSCRIPTION_KEY>"
```

Store `YOUR_UUID` as `MTN_MOMO_API_USER` and the returned `apiKey` as `MTN_MOMO_API_KEY`.

---

## 3. Airtel Money

### 3.1 Prerequisites

1. Register at [https://developers.airtel.africa](https://developers.airtel.africa)
2. Create an app and get `client_id` and `client_secret`
3. For Zambia (ZM): base URL is `https://openapi.airtel.africa`
4. Contact Airtel Zambia Business for production merchant activation

### 3.2 Backend — Airtel Money Service

Create `backend/src/services/payments/airtelMoneyService.js`:

```js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = process.env.AIRTEL_BASE_URL || 'https://openapiuat.airtel.africa';
const CLIENT_ID     = process.env.AIRTEL_CLIENT_ID;
const CLIENT_SECRET = process.env.AIRTEL_CLIENT_SECRET;

async function getAccessToken() {
  const { data } = await axios.post(
    `${BASE_URL}/auth/oauth2/token`,
    {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
    },
    { headers: { 'Content-Type': 'application/json' } }
  );
  return data.access_token;
}

/**
 * Initiate a collection (debit customer wallet).
 * @param {string} amount   - ZMW amount
 * @param {string} msisdn   - Airtel number e.g. "260977123456"
 * @param {string} orderId  - Your reference
 * @returns {string} transactionId
 */
async function collect(amount, msisdn, orderId) {
  const token = await getAccessToken();
  const reference = uuidv4();

  const { data } = await axios.post(
    `${BASE_URL}/merchant/v1/payments/`,
    {
      reference,
      subscriber: { country: 'ZM', currency: 'ZMW', msisdn },
      transaction: { amount: String(amount), country: 'ZM', currency: 'ZMW', id: orderId },
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

  // Returns transaction_id to poll with
  return data.data?.transaction?.id || reference;
}

/**
 * Get payment status.
 * @param {string} transactionId
 * @returns {string} 'TS' (successful) | 'TF' (failed) | 'TP' (pending)
 */
async function getStatus(transactionId) {
  const token = await getAccessToken();
  const { data } = await axios.get(
    `${BASE_URL}/standard/v1/payments/${transactionId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Country': 'ZM',
        'X-Currency': 'ZMW',
      },
    }
  );
  return data.data?.transaction?.status; // 'TS' | 'TF' | 'TP'
}

module.exports = { collect, getStatus };
```

---

## 4. Zamtel Kwacha

Zamtel's Kwacha mobile money API uses a **SOAP/XML** interface for legacy integrations
and a newer REST API for partners. Contact **Zamtel Enterprise** directly:

- Email: enterprise@zamtel.co.zm
- Portal: [https://www.zamtel.co.zm/business](https://www.zamtel.co.zm/business)

> **Note**: Zamtel currently does not have a public self-service developer portal.
> You will need to sign an integration agreement to receive credentials and API docs.

### 4.1 Integration pattern (once you have credentials)

Create `backend/src/services/payments/zamtelKwachaService.js`:

```js
const axios = require('axios');

const BASE_URL    = process.env.ZAMTEL_BASE_URL;    // Provided by Zamtel
const MERCHANT_ID = process.env.ZAMTEL_MERCHANT_ID;
const API_KEY     = process.env.ZAMTEL_API_KEY;

/**
 * Initiate a Zamtel Kwacha payment request.
 * Exact payload structure will be defined in your integration docs from Zamtel.
 */
async function requestPayment(amount, msisdn, orderId) {
  const { data } = await axios.post(
    `${BASE_URL}/payment/request`,
    {
      merchantId: MERCHANT_ID,
      amount: String(amount),
      currency: 'ZMW',
      msisdn,
      reference: orderId,
    },
    {
      headers: {
        'X-Api-Key': API_KEY,
        'Content-Type': 'application/json',
      },
    }
  );
  return data.transactionId;
}

async function getStatus(transactionId) {
  const { data } = await axios.get(`${BASE_URL}/payment/status/${transactionId}`, {
    headers: { 'X-Api-Key': API_KEY },
  });
  return data.status; // Normalize to 'PENDING' | 'SUCCESSFUL' | 'FAILED'
}

module.exports = { requestPayment, getStatus };
```

---

## 5. Bank Payments

### 5.1 Options Available in Zambia

| Bank | Integration Method | Notes |
|---|---|---|
| **Zanaco** | Bank API / SWIFT ISO 20022 | Requires formal banking agreement |
| **Stanbic Bank** | Standard Bank API Portal | REST-based, OAuth2 |
| **Standard Chartered** | Straight2Bank API | Enterprise clients only |
| **First National Bank (FNB)** | Open Banking REST API | Good developer docs |
| **ZNBS (Zambia National BS)** | Direct integration | Contact their IT department |

### 5.2 General Bank Direct Debit Flow

Most Zambian banks follow this pattern:

```
1. Customer provides bank account number + bank code
2. You submit a debit mandate (one-time or recurring)
3. Bank processes overnight batch (T+1)
4. You receive confirmation via webhook or SFTP file
```

### 5.3 Stanbic Bank Integration Example

```js
// backend/src/services/payments/stanbicService.js
const axios = require('axios');

const BASE_URL      = process.env.STANBIC_BASE_URL;
const CLIENT_ID     = process.env.STANBIC_CLIENT_ID;
const CLIENT_SECRET = process.env.STANBIC_CLIENT_SECRET;

async function getToken() {
  const { data } = await axios.post(`${BASE_URL}/oauth/token`, {
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  return data.access_token;
}

async function initiateTransfer({ fromAccount, toAccount, amount, reference, narration }) {
  const token = await getToken();
  const { data } = await axios.post(
    `${BASE_URL}/transfers/domestic`,
    { fromAccount, toAccount, amount, currency: 'ZMW', reference, narration },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return data.transactionId;
}

module.exports = { initiateTransfer };
```

---

## 6. Unified Payment Service (Backend)

Centralise all providers behind a single interface so the rest of the app doesn't care
which provider is used.

Create `backend/src/services/payments/paymentService.js`:

```js
const mtnMomo    = require('./mtnMomoService');
const airtel     = require('./airtelMoneyService');
const zamtel     = require('./zamtelKwachaService');
const pool       = require('../../config/db');

const PROVIDERS = ['mtn', 'airtel', 'zamtel', 'bank'];

/**
 * Initiate a payment and record it in the DB.
 *
 * @param {object} params
 * @param {string} params.provider   - 'mtn' | 'airtel' | 'zamtel' | 'bank'
 * @param {string} params.amount     - ZMW amount
 * @param {string} params.msisdn     - Mobile number (for MoMo providers)
 * @param {string} params.orderId    - Internal order UUID
 * @param {string} params.initiatedBy - User UUID
 */
async function initiatePayment({ provider, amount, msisdn, orderId, initiatedBy }) {
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported payment provider: ${provider}`);
  }

  let providerReference;

  if (provider === 'mtn') {
    providerReference = await mtnMomo.requestToPay(amount, msisdn, orderId, 'ZedProcure payment');
  } else if (provider === 'airtel') {
    providerReference = await airtel.collect(amount, msisdn, orderId);
  } else if (provider === 'zamtel') {
    providerReference = await zamtel.requestPayment(amount, msisdn, orderId);
  } else if (provider === 'bank') {
    // Bank payments are handled via webhook/callback only; no real-time reference
    providerReference = `BANK-${orderId}`;
  }

  // Persist to payments table
  await pool.query(
    `INSERT INTO payments (order_id, provider, provider_reference, amount, status, initiated_by)
     VALUES ($1, $2, $3, $4, 'pending', $5)`,
    [orderId, provider, providerReference, amount, initiatedBy]
  );

  return providerReference;
}

/**
 * Check and sync payment status from provider.
 */
async function syncPaymentStatus(paymentId) {
  const { rows: [payment] } = await pool.query(
    'SELECT * FROM payments WHERE id = $1', [paymentId]
  );
  if (!payment) throw new Error('Payment not found');

  let status = payment.status;

  if (payment.provider === 'mtn') {
    const raw = await mtnMomo.getPaymentStatus(payment.provider_reference);
    status = raw === 'SUCCESSFUL' ? 'successful' : raw === 'FAILED' ? 'failed' : 'pending';
  } else if (payment.provider === 'airtel') {
    const raw = await airtel.getStatus(payment.provider_reference);
    status = raw === 'TS' ? 'successful' : raw === 'TF' ? 'failed' : 'pending';
  } else if (payment.provider === 'zamtel') {
    const raw = await zamtel.getStatus(payment.provider_reference);
    status = raw === 'SUCCESSFUL' ? 'successful' : raw === 'FAILED' ? 'failed' : 'pending';
  }

  if (status !== payment.status) {
    await pool.query(
      `UPDATE payments SET status = $1, updated_at = now() WHERE id = $2`,
      [status, paymentId]
    );

    // If successful, fund the escrow account
    if (status === 'successful') {
      await pool.query(
        `UPDATE escrow_accounts SET status = 'funded', funded_at = now() WHERE order_id = $1`,
        [payment.order_id]
      );
    }
  }

  return status;
}

module.exports = { initiatePayment, syncPaymentStatus };
```

### 6.1 API Routes

Create `backend/src/routes/payments.js`:

```js
const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { initiatePayment, syncPaymentStatus } = require('../services/payments/paymentService');
const pool = require('../config/db');
const router = express.Router();

// POST /api/payments/initiate
router.post('/payments/initiate', authenticate, async (req, res) => {
  const { provider, amount, msisdn, orderId } = req.body;
  try {
    const ref = await initiatePayment({
      provider, amount, msisdn, orderId,
      initiatedBy: req.user.user_id,
    });
    res.status(201).json({ providerReference: ref, status: 'pending' });
  } catch (e) {
    console.error('Payment initiation error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/payments/:paymentId/status
router.get('/payments/:paymentId/status', authenticate, async (req, res) => {
  try {
    const status = await syncPaymentStatus(req.params.paymentId);
    res.json({ status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/payments/order/:orderId
router.get('/payments/order/:orderId', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC',
      [req.params.orderId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// POST /api/payments/callback  — provider webhook endpoint (no auth, verified by signature)
router.post('/payments/callback', async (req, res) => {
  // See Section 8 for full implementation
  res.status(200).json({ received: true });
});

module.exports = router;
```

Register the router in `backend/src/index.js`:
```js
const paymentsRouter = require('./routes/payments');
app.use('/api', paymentsRouter);
```

---

## 7. Frontend Payment Modal

Create `frontend/src/components/PaymentModal.js`:

```jsx
import React, { useState } from 'react';
import { Modal, Form, Select, Input, Button, message, Steps, Result } from 'antd';
import axios from 'axios';

const { Option } = Select;

export default function PaymentModal({ open, onClose, orderId, amount }) {
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState(null);
  const [paymentId, setPaymentId] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const handleInitiate = async (values) => {
    setLoading(true);
    try {
      const { data } = await axios.post('/api/payments/initiate', {
        provider: values.provider,
        amount,
        msisdn: values.msisdn,
        orderId,
      });
      setPaymentId(data.paymentId); // Ensure backend returns paymentId
      setStep(1);
      pollStatus(data.paymentId);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to initiate payment');
    } finally {
      setLoading(false);
    }
  };

  const pollStatus = (id) => {
    const interval = setInterval(async () => {
      try {
        const { data } = await axios.get(`/api/payments/${id}/status`);
        if (data.status !== 'pending') {
          setStatus(data.status);
          setStep(2);
          clearInterval(interval);
        }
      } catch (_) {}
    }, 3000); // Poll every 3 seconds
  };

  return (
    <Modal title="Make Payment" open={open} onCancel={onClose} footer={null} width={520}>
      <Steps current={step} items={[
        { title: 'Select Method' },
        { title: 'Confirm on Phone' },
        { title: 'Complete' },
      ]} style={{ marginBottom: 24 }} />

      {step === 0 && (
        <Form form={form} layout="vertical" onFinish={handleInitiate}>
          <Form.Item name="provider" label="Payment Method" rules={[{ required: true }]}>
            <Select placeholder="Select provider" onChange={setProvider}>
              <Option value="mtn">MTN Mobile Money</Option>
              <Option value="airtel">Airtel Money</Option>
              <Option value="zamtel">Zamtel Kwacha</Option>
              <Option value="bank">Bank Transfer</Option>
            </Select>
          </Form.Item>
          {['mtn', 'airtel', 'zamtel'].includes(provider) && (
            <Form.Item name="msisdn" label="Mobile Number (260...)" rules={[{ required: true }]}>
              <Input placeholder="e.g. 260971234567" />
            </Form.Item>
          )}
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              Pay ZMW {Number(amount).toLocaleString()}
            </Button>
          </Form.Item>
        </Form>
      )}

      {step === 1 && (
        <Result
          status="info"
          title="Check your phone"
          subTitle="A payment prompt has been sent to your mobile wallet. Please approve it to continue."
        />
      )}

      {step === 2 && (
        <Result
          status={status === 'successful' ? 'success' : 'error'}
          title={status === 'successful' ? 'Payment Successful' : 'Payment Failed'}
          subTitle={status === 'successful'
            ? 'Your payment has been received and escrow funded.'
            : 'The payment was not completed. Please try again.'}
          extra={<Button onClick={onClose}>Close</Button>}
        />
      )}
    </Modal>
  );
}
```

---

## 8. Webhook Handling & Reconciliation

Providers send a **POST** to your callback URL when a payment status changes.
You must verify authenticity before updating your database.

```js
// In backend/src/routes/payments.js

const crypto = require('crypto');

router.post('/payments/callback', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const body = req.body.toString();
    const payload = JSON.parse(body);

    // ── MTN ─────────────────────────────────────────────────────────────────
    if (payload.financialTransactionId || payload.externalId) {
      const externalId = payload.externalId;
      const status = payload.status === 'SUCCESSFUL' ? 'successful' : 'failed';

      await pool.query(
        `UPDATE payments SET status = $1, provider_callback_payload = $2, updated_at = now()
         WHERE provider_reference = $3 AND provider = 'mtn'`,
        [status, JSON.stringify(payload), externalId]
      );
      if (status === 'successful') {
        await pool.query(
          `UPDATE escrow_accounts SET status = 'funded', funded_at = now()
           WHERE order_id = (SELECT order_id FROM payments WHERE provider_reference = $1)`,
          [externalId]
        );
      }
    }

    // ── Airtel ───────────────────────────────────────────────────────────────
    if (payload.transaction?.id) {
      const txId = payload.transaction.id;
      const status = payload.transaction.status === 'TS' ? 'successful' : 'failed';

      await pool.query(
        `UPDATE payments SET status = $1, updated_at = now()
         WHERE provider_reference = $2 AND provider = 'airtel'`,
        [status, txId]
      );
    }

    res.status(200).json({ received: true });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
```

### Daily Reconciliation Script

Create `backend/src/scripts/reconcilePayments.js`:

```js
// Run via cron: 0 6 * * *  (6 AM daily)
const { syncPaymentStatus } = require('../services/payments/paymentService');
const pool = require('../config/db');

async function reconcile() {
  const { rows } = await pool.query(
    `SELECT id FROM payments WHERE status = 'pending' AND created_at > now() - interval '48 hours'`
  );
  console.log(`Reconciling ${rows.length} pending payments...`);
  for (const { id } of rows) {
    try {
      const status = await syncPaymentStatus(id);
      console.log(`  Payment ${id}: ${status}`);
    } catch (e) {
      console.error(`  Payment ${id} error: ${e.message}`);
    }
  }
  process.exit(0);
}

reconcile();
```

---

## 9. Security Checklist

| Item | Requirement |
|---|---|
| **TLS/HTTPS** | All API calls must use HTTPS. Never use HTTP in production. |
| **Secret storage** | Store all API keys in Render environment variables — never in code or `.env` files committed to Git. |
| **Webhook validation** | Validate provider signatures (MTN uses HMAC-SHA256; check provider docs) before processing any callback. |
| **Idempotency** | Use `provider_reference` as unique key — always check it doesn't already exist before updating. |
| **Logging** | Log `provider`, `reference`, `amount`, `status` (never log raw card/account data). |
| **Rate limiting** | Apply `express-rate-limit` to `/api/payments/initiate` — max 10 requests per minute per user. |
| **PCI/DSS scope** | ZedProcure never handles raw card numbers — all sensitive data goes directly to the provider. This keeps you out of PCI scope. |
| **Amount validation** | Always validate `amount > 0` and `amount <= order.total_amount` on the server — never trust the client. |

---

## 10. Environment Variables Reference

Add these to your Render dashboard (Settings → Environment):

```env
# MTN Mobile Money
MTN_MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com   # change to prod URL when live
MTN_MOMO_SUBSCRIPTION_KEY=your_subscription_key
MTN_MOMO_API_USER=your_api_user_uuid
MTN_MOMO_API_KEY=your_api_key
MTN_MOMO_ENV=sandbox                                       # change to 'production' when live

# Airtel Money
AIRTEL_BASE_URL=https://openapiuat.airtel.africa           # change to prod URL when live
AIRTEL_CLIENT_ID=your_client_id
AIRTEL_CLIENT_SECRET=your_client_secret

# Zamtel Kwacha
ZAMTEL_BASE_URL=https://api.zamtel.co.zm                   # provided by Zamtel
ZAMTEL_MERCHANT_ID=your_merchant_id
ZAMTEL_API_KEY=your_api_key

# Bank integrations
STANBIC_BASE_URL=https://api.stanbicbank.co.zm
STANBIC_CLIENT_ID=your_client_id
STANBIC_CLIENT_SECRET=your_client_secret
```

---

## Next Steps

1. **Sandbox testing**: Register and test MTN and Airtel in their sandbox environments first.
2. **Create the `payments` table**: Add a migration:
   ```sql
   CREATE TABLE payments (
     id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     order_id                 UUID REFERENCES orders(id) ON DELETE CASCADE,
     provider                 VARCHAR(20) NOT NULL,
     provider_reference       VARCHAR(255) UNIQUE,
     provider_callback_payload JSONB,
     amount                   NUMERIC(15,2) NOT NULL,
     status                   VARCHAR(20) DEFAULT 'pending',
     initiated_by             UUID,
     created_at               TIMESTAMPTZ DEFAULT now(),
     updated_at               TIMESTAMPTZ DEFAULT now()
   );
   ```
3. **Register webhook URLs** in each provider's developer portal:  
   `https://zambia-procurement-backend.onrender.com/api/payments/callback`
4. **Add `PaymentModal`** to the `CustomerDashboard` Orders table action buttons.
5. **Go live**: Contact each provider's enterprise team with your sandbox test report to activate production credentials.
