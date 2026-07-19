# ZedProcure — Zambia Procurement Platform

> A multi-tenant, end-to-end procurement, accounting, escrow, and supplier-management platform built for Zambian procurement workflows.

[![CI](https://github.com/JamieWamz/zedprocure/actions/workflows/ci.yml/badge.svg)](https://github.com/JamieWamz/zedprocure/actions/workflows/ci.yml)

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Repository Structure](#4-repository-structure)
5. [Git Branching Strategy](#5-git-branching-strategy)
6. [Platform Capabilities](#6-platform-capabilities)
7. [Payment Integrations](#7-payment-integrations)
8. [Security Model](#8-security-model)
9. [Deployment — Render (Production)](#9-deployment--render-production)
10. [Local Development](#10-local-development)
11. [CI/CD Pipelines](#11-cicd-pipelines)
12. [Key API Reference](#12-key-api-reference)
13. [Platform Admin Access](#13-platform-admin-access)
14. [Onboarding](#14-onboarding)
15. [Environment Variables](#15-environment-variables)
16. [License](#16-license)

---

## 1. Platform Overview

ZedProcure is a **multi-tenant SaaS** platform that digitises the full procurement lifecycle for Zambian organisations — from supplier onboarding and bid management, through order tracking and escrow, to accounting and digital signatures.

**Two platform administrator roles:**

| Role | Responsibilities |
|---|---|
| **System Admin** | Platform health, organisations, users, suppliers, audit trail, system-wide visibility |
| **Business Admin** | Procurement operations, bid management, supplier verification, invoicing, escrow release, financial reporting |

There is no tenant-admin role. Customers and suppliers self-register. Suppliers start as `pending` and must be verified by Business Admin before participating in bids.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Ant Design 5, React Router, Axios, Recharts |
| **Backend** | Node.js 22, Express 4, httpOnly cookie JWT auth, Multer uploads, Winston logging |
| **Database** | PostgreSQL 15 with `uuid-ossp`, `node-pg-migrate` |
| **Payments** | MTN Mobile Money, Airtel Money, Zamtel Kwacha, Bank Transfer |
| **Deployment** | Render (web service + static site + managed Postgres) |
| **CI/CD** | GitHub Actions |
| **Docker** | Docker Compose for local/self-hosted environments |

---

## 3. Architecture

```
┌─────────────────────────────────────────────┐
│              React Frontend (SPA)            │
│  CustomerPortal · SupplierPortal · AdminPortal│
└──────────────────────┬──────────────────────┘
                       │ HTTPS / Axios + httpOnly cookies
┌──────────────────────▼──────────────────────┐
│           Express.js Backend API             │
│  Auth · Bids · Orders · Escrow · Invoices    │
│  Ledger · Signatures · Notifications         │
│  ┌─────────────────────────────────────┐    │
│  │       Payment Service (Unified)      │    │
│  │  MTN MoMo · Airtel · Zamtel · Bank  │    │
│  └─────────────────────────────────────┘    │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│           PostgreSQL 15 Database             │
│  Tenants · Users · Bids · Orders · Escrow   │
│  Invoices · Ledger · Signatures · Payments  │
└─────────────────────────────────────────────┘
```

**Key design principles:**
- **Tenant isolation** enforced via `X-Tenant-ID` headers and DB-level filtering on every query
- **Double-entry bookkeeping** — all financial events create immutable journal entries
- **Escrow-first** — buyer funds are held in escrow and released only after fulfillment
- **Zero client-side payment secrets** — all provider calls happen server-side

---

## 4. Repository Structure

```text
zedprocure/
├── backend/
│   └── src/
│       ├── config/           # DB pool, auth config
│       ├── db/
│       │   ├── migrations/   # node-pg-migrate migration files
│       │   ├── init.js       # Startup DB initialisation
│       │   └── schema.sql    # Reference schema
│       ├── middleware/       # Auth, tenant context, rate limiting
│       ├── routes/           # Express route handlers
│       │   ├── auth.js
│       │   ├── bid.js
│       │   ├── order.js
│       │   ├── payment.js    # Bidding fees + mobile money endpoints
│       │   ├── escrow.js
│       │   ├── invoices.js
│       │   ├── ledger.js
│       │   ├── signatures.js
│       │   ├── supplier.js
│       │   ├── verification.js
│       │   └── ...
│       └── services/
│           ├── payments/
│           │   ├── mtnMomoService.js      # MTN Mobile Money
│           │   ├── airtelMoneyService.js  # Airtel Money
│           │   ├── zamtelKwachaService.js # Zamtel Kwacha
│           │   └── paymentService.js      # Unified payment layer
│           ├── ledgerService.js
│           ├── notificationService.js
│           └── walletService.js
├── frontend/
│   └── src/
│       ├── components/       # All React components
│       │   ├── PaymentModal.js          # MTN/Airtel/Zamtel/Bank UI
│       │   ├── CustomerDashboard.js
│       │   ├── SupplierDashboard.js
│       │   ├── DigitalSignatureModal.js
│       │   └── ...
│       ├── context/
│       │   └── AuthContext.js  # JWT + tenant header management
│       ├── App.js
│       └── index.js
├── docs/
│   └── PAYMENT_INTEGRATION.md  # Full payment API integration guide
├── nginx/                       # Nginx config for Docker deployments
├── .github/workflows/           # CI/CD pipelines
├── BRANCHES.md                  # Git branching strategy
├── render.yaml                  # Render deployment blueprint
├── docker-compose.yml
├── Dockerfile.backend
└── Dockerfile.frontend
```

---

## 5. Git Branching Strategy

See [BRANCHES.md](./BRANCHES.md) for the full workflow guide.

| Branch | Purpose |
|---|---|
| `main` | Latest integrated code — Render auto-deploys from here |
| `production` | Stable release snapshot — only updated via PRs from `test` |
| `staging` | Pre-release integration testing |
| `test` | QA & automated test verification |
| `working` | Safe snapshot before large refactors |
| `features` | Base for all new feature branches |

**Promotion flow:**
```
features/your-feature  →  staging  →  test  →  production
```

---

## 6. Platform Capabilities

### Procurement
- Organic customer registration with buyer organisation creation
- Organic supplier registration with compliance document upload and Business Admin verification
- Multi-step bid creation wizard (title, requirements, BoQ, suppliers, deadline, visibility)
- Public bid noticeboard for open/global bids
- Supplier bid invitation, response submission, and bidding-fee workflow
- Bid evaluation, award, and order creation with audit trail
- Order status lifecycle: `pending_acceptance → accepted → delivery_in_progress → delivered → completed`

### Finance & Accounting
- AR/AP invoicing with aging, payment recording, reminders, and CSV/PDF export
- **Double-entry ledger** — chart of accounts, journal, trial balance, income statement, balance sheet, cash-flow reporting
- **Escrow** — buyer funds held in escrow, released by Business Admin after fulfillment
- **Mobile money & bank payments** — MTN, Airtel, Zamtel, Bank (see §7)
- Wallet system for supplier bidding fees

### Portals
| Portal | Key Features |
|---|---|
| **Customer Portal** | Requirements, invoices, orders, **Pay Now** (mobile money), escrow funding, digital signatures |
| **Supplier Portal** | Bid opportunities, compliance verification & document upload, orders & contracts, digital signatures, notifications |
| **Business Admin** | Full procurement ops, supplier verification, bid/order management, invoicing, escrow release, financial reports |
| **System Admin** | Platform health, user management, organisation oversight, audit logs |

### Other
- Real-time notifications with 30s polling and mark-as-read
- Paperless **digital signatures** on invoices and orders (signer identity, consent, SHA hash, timestamp, IP/user-agent, audit log)
- Supplier compliance tracking with per-document status (PACRA, ZRA TPIN, Tax Clearance, Business License, Directors ID, Bank Reference)

---

## 7. Payment Integrations

ZedProcure integrates with all major Zambian payment providers. See [docs/PAYMENT_INTEGRATION.md](./docs/PAYMENT_INTEGRATION.md) for the full developer guide.

| Provider | Type | Status | Portal |
|---|---|---|---|
| **MTN Mobile Money** | Mobile wallet | Ready (needs credentials) | [momodeveloper.mtn.com](https://momodeveloper.mtn.com) |
| **Airtel Money** | Mobile wallet | Ready (needs credentials) | [developers.airtel.africa](https://developers.airtel.africa) |
| **Zamtel Kwacha** | Mobile wallet | Ready (needs credentials) | Contact enterprise@zamtel.co.zm |
| **Bank Transfer** | Direct debit | Ready (webhook-based) | Contact your bank |

**How it works:**
1. Customer clicks **Pay Now** on any unfunded order
2. Selects provider and enters their mobile number
3. A payment prompt is sent to their phone instantly
4. The platform polls the provider every 4 seconds
5. On success → escrow account is automatically funded
6. Providers can also push status updates via the webhook endpoint:
   `POST /api/payments/mobile/callback?provider=mtn`

**To activate:** Set the required env vars in the Render dashboard (see §15).

---

## 8. Security Model

- **Authentication**: httpOnly, SameSite cookies. Tokens never stored in `localStorage`.
- **Tenant isolation**: Every query is scoped by `tenant_id` extracted from the authenticated user.
- **CORS**: Restricted to `CORS_ORIGINS` — no wildcard in production.
- **Passwords**: Minimum 10 characters, uppercase + lowercase + number + symbol required.
- **Uploads**: Validated by both MIME type and file extension; random filenames; 10MB limit.
- **Budget isolation**: Customer procurement budgets are never visible to suppliers.
- **Escrow**: Fund/release operations use DB transactions + row-level locks.
- **Ledger**: Journal entries and lines are immutable by design.
- **Signatures**: Record signer identity, consent text, SHA-256 hash, timestamp, IP, user-agent, and write audit log entries.
- **Admin seats**: Only one active System Admin and one Business Admin seat at any time.
- **Payment secrets**: All provider API calls are server-side — no credentials ever reach the browser.

**Never commit:** `.env`, private keys, `DATABASE_URL`, database dumps, or uploaded files.

---

## 9. Deployment — Render (Production)

The project uses a **Render Blueprint** (`render.yaml`) to define both services:

| Service | Type | URL |
|---|---|---|
| `zambia-procurement-backend` | Web Service (Node) | `https://zambia-procurement-backend.onrender.com` |
| `zedprocure` | Static Site (React) | `https://zedprocure.onrender.com` |
| `zambia-procurement-db` | Managed PostgreSQL 15 | Internal `DATABASE_URL` |

**Deploying:**
```bash
# Just push to main — Render auto-deploys
git push origin main
```

Database migrations run automatically as a `preDeployCommand`:
```bash
npm run migrate:up
```

**Required secrets in Render Dashboard → Environment:**

```env
JWT_SECRET=<openssl rand -hex 32>
SYSTEM_ADMIN_PASSWORD=<strong-password>
BUSINESS_ADMIN_PASSWORD=<strong-password>
```

---

## 10. Local Development

### Option A — Docker Compose (recommended)

```bash
# Copy and fill in the env file
cp .env.example .env

# Build and start everything
docker compose up --build
```

- Frontend: http://localhost
- Backend API: http://localhost:4000

### Option B — Manual

**Backend:**
```bash
cd backend
npm ci
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, etc.
npm run dev
```

**Frontend:**
```bash
cd frontend
npm ci
npm start
```

Requires a local or Docker PostgreSQL 15 instance.

---

## 11. CI/CD Pipelines

Workflows live in [`.github/workflows/`](.github/workflows/).

| Workflow | Trigger | Steps |
|---|---|---|
| `ci.yml` | Push / PR to `main` | `npm ci` → syntax check → frontend build → Docker Compose validate → Docker image build |
| `pages.yml` | Push to `main` | Build React → deploy to GitHub Pages |
| `cd.yml` | Manual (`workflow_dispatch`) | SSH into server → `git pull` → `docker compose up --build -d` |

---

## 12. Key API Reference

| Area | Endpoints |
|---|---|
| **Auth** | `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/me` |
| **Registration** | `POST /api/register`, `POST /api/forgot-password`, `POST /api/reset-password` |
| **Suppliers** | `GET /api/supplier/profile`, `POST /api/supplier/documents`, `GET /api/supplier/verification/status` |
| **Bids** | `GET /api/public/bids`, `GET /api/tenant/bids`, `POST /api/tenants/:id/bids`, `GET /api/supplier/bids` |
| **Requirements** | `POST /api/bids/:id/requirements` (upsert) |
| **Orders** | `GET /api/orders`, `POST /api/bids/:id/award`, `PATCH /api/orders/:id/status` |
| **Payments (Bidding Fee)** | `POST /api/payments/bidding-fee`, `POST /api/payments/confirm` |
| **Payments (Mobile Money)** | `POST /api/payments/mobile/initiate`, `GET /api/payments/mobile/:id/status` |
| **Payments (History)** | `GET /api/payments/mobile/order/:orderId` |
| **Payments (Webhook)** | `POST /api/payments/mobile/callback?provider=mtn\|airtel\|zamtel\|bank` |
| **Escrow** | `POST /api/escrow/fund`, `POST /api/escrow/release` |
| **Invoices** | `GET /api/invoices`, `GET /api/invoices/summary`, `GET /api/invoices/aging` |
| **Ledger** | `GET /api/ledger/accounts`, `GET /api/ledger/trial-balance`, `GET /api/ledger/income-statement` |
| **Signatures** | `POST /api/signatures`, `GET /api/signatures/:type/:id` |
| **Notifications** | `GET /api/notifications`, `PUT /api/notifications/:id/read` |
| **Admin** | `GET /api/admin/*`, `GET /api/system/*` |

---

## 13. Platform Admin Access

Seeded administrator emails:

| Seat | Email |
|---|---|
| System Admin | `wamuyuwamundia@gmail.com` |
| Business Admin | `brightilunga6@gmail.com` |

Passwords are **never hardcoded**. Set `SYSTEM_ADMIN_PASSWORD` and `BUSINESS_ADMIN_PASSWORD` in the environment before first startup. If omitted, strong random passwords are generated and printed once in backend logs — store them securely.

---

## 14. Onboarding

### Customers
1. Click **Register** on the login page → select **Customer / Buyer**
2. Fill in your personal details and organisation information
3. Access the **Customer Portal** to submit procurement requirements, browse bids, fund escrow, and sign documents

### Suppliers
1. Click **Register** → select **Supplier**
2. Upload compliance documents from the **Supplier Portal → Verification Status**
   - PACRA Certificate
   - ZRA TPIN Certificate
   - ZRA Tax Clearance
   - Business License
   - Directors' ID Copies
   - Bank Reference Letter
3. Business Admin reviews and verifies your account
4. Once verified, you appear in bid invitation flows and can respond to bids

---

## 15. Environment Variables

### Core (required in all environments)

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
JWT_SECRET=<64-char hex string>
CORS_ORIGINS=https://zedprocure.onrender.com
COOKIE_SECURE=true
NODE_ENV=production
SYSTEM_ADMIN_PASSWORD=<strong-password>
BUSINESS_ADMIN_PASSWORD=<strong-password>
APP_URL=https://zedprocure.onrender.com
```

### Payment Providers (set in Render dashboard as secrets)

```env
# MTN Mobile Money — register at momodeveloper.mtn.com
MTN_MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com
MTN_MOMO_SUBSCRIPTION_KEY=your_subscription_key
MTN_MOMO_API_USER=your_api_user_uuid
MTN_MOMO_API_KEY=your_api_key
MTN_MOMO_ENV=sandbox   # → 'production' when going live

# Airtel Money — register at developers.airtel.africa
AIRTEL_BASE_URL=https://openapiuat.airtel.africa
AIRTEL_CLIENT_ID=your_client_id
AIRTEL_CLIENT_SECRET=your_client_secret

# Zamtel Kwacha — contact enterprise@zamtel.co.zm
ZAMTEL_BASE_URL=https://api.zamtel.co.zm
ZAMTEL_MERCHANT_ID=your_merchant_id
ZAMTEL_API_KEY=your_api_key
```

### Optional

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=<smtp-password>
```

---

## 16. License

Internal use — ZedProcure / JamieWamz.
