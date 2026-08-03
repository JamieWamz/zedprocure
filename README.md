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

### Latest developments (August 2026)

- **Responsive portal experience:** shared responsive styles now support screens down to 320px, with overflow-safe tables, forms and modals plus stacked mobile controls. Business Admin has mobile navigation, an action grid, swipeable metric cards and responsive invoice/review workflows; System Admin user maintenance changes from a table to compact cards below 768px.
- **Enforced invite-only procurement:** restricted bids require at least one active, verified supplier. The bid wizard loads the verified-supplier directory, persists invitations, prevents publishing without invitees and keeps restricted bids out of public/general discovery. Uninvited suppliers cannot view, express interest in or respond to them.
- **Reliable self-registration:** customer and supplier account creation is transactional, performs normalized cross-account email checks and is not rolled back if a welcome email cannot be sent. The registration repair migration restores missing supplier-category, verification and document metadata on older databases.
- **Shorter login throttle:** the login endpoint permits up to 10 requests per IP in a 10-minute window, reduced from 15 minutes.
- **System user maintenance:** System Admin can search and filter platform, organisation and supplier accounts, view their affiliation, and edit full name, normalized email or active status. Changes are audited and protect the primary administrator, the current administrator, active role seats and cross-account email ownership.
- **Safer identity handling:** `identityEmailGuard.js` coordinates normalized email writes across all account tables using transaction-scoped advisory locks. Login, password-reset and wallet-recipient resolution fail closed when legacy data contains ambiguous identities.
- **Professional source names:** unclear route, service, component and utility filenames were replaced with purpose-specific names while preserving existing public URLs and portal behavior.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Ant Design 5, React Router, Axios, Recharts |
| **Backend** | Node.js 24, Express 4, httpOnly cookie JWT auth, Multer uploads, Winston logging |
| **Database** | PostgreSQL 15 with `uuid-ossp`, `node-pg-migrate` |
| **Payments** | MTN MoMo Collection/Disbursement, Airtel C2B/B2C, Zamtel Collection, configurable Bank APIs |
| **Queue/Locks** | Redis-compatible Render Key Value with PostgreSQL advisory-lock fallback |
| **Deployment** | Render (web service + static site + managed Postgres) |
| **CI/CD** | GitHub Actions |
| **Docker** | Docker Compose for local/self-hosted environments |

---

## 3. Architecture

```
┌─────────────────────────────────────────────┐
│              React Frontend (SPA)            │
│ Customer · Supplier · Business/System Admin  │
└──────────────────────┬──────────────────────┘
                       │ HTTPS / Axios + httpOnly cookies
┌──────────────────────▼──────────────────────┐
│           Express.js Backend API             │
│  Auth · Bids · Orders · Escrow · Invoices    │
│  Ledger · Signatures · Notifications         │
│  ┌─────────────────────────────────────┐    │
│  │ Payment + Escrow State Machine       │    │
│  │ MTN C2B/B2C · Airtel C2B/B2C · Bank │    │
│  └─────────────────────────────────────┘    │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│ PostgreSQL 15 + Redis-compatible lock store  │
│  Tenants · Users · Bids · Orders · Escrow   │
│  Invoices · Ledger · Signatures · Payments  │
└─────────────────────────────────────────────┘
```

**Key design principles:**
- **Tenant and ownership isolation** enforced through authenticated role/ownership checks and tenant filters on tenant-owned queries
- **Global identity safety** through normalized cross-table email checks, transactional advisory locks and fail-closed identity resolution
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
│       │   ├── currentUser.js
│       │   ├── order.js
│       │   ├── payment.js    # Bidding fees + mobile money endpoints
│       │   ├── escrow.js
│       │   ├── invoices.js
│       │   ├── ledger.js
│       │   ├── signatures.js
│       │   ├── supplier.js
│       │   ├── system.js
│       │   ├── verification.js
│       │   ├── verifiedSupplierDirectory.js
│       │   └── ...
│       └── services/
│           ├── payments/
│           │   ├── mtnMomoService.js      # MTN Mobile Money
│           │   ├── airtelMoneyService.js  # Airtel Money
│           │   ├── zamtelKwachaService.js # Zamtel Kwacha
│           │   └── paymentService.js      # Unified payment layer
│           ├── bidSubmissionValidator.js
│           ├── identityEmailGuard.js
│           ├── invoicePdfService.js
│           ├── ledgerService.js
│           ├── notificationService.js
│           └── walletService.js
├── frontend/
│   └── src/
│       ├── components/       # All React components
│       │   ├── AuthenticationPage.js
│       │   ├── InvitationAcceptancePage.js
│       │   ├── BusinessAdminPortal.js
│       │   ├── SystemAdministrationPortal.js
│       │   ├── BidManagement.js
│       │   ├── InvoiceManagement.js
│       │   ├── OrganizationManagement.js
│       │   ├── ActionableEmptyState.js
│       │   ├── PaymentModal.js          # MTN/Airtel/Zamtel/Bank UI
│       │   ├── CustomerDashboard.js
│       │   ├── SupplierDashboard.js
│       │   ├── DigitalSignatureModal.js
│       │   └── ...
│       ├── context/
│       │   └── AuthContext.js  # JWT + tenant header management
│       ├── utils/
│       │   ├── paymentPollingState.js
│       │   └── systemUserMaintenance.js
│       ├── remoteImageAssets.js
│       ├── App.js
│       └── index.js
├── docs/
│   ├── BRANCHING_STRATEGY.md   # Git branching strategy
│   ├── ENGINEERING_HISTORY.md  # Archived implementation history
│   ├── PAYMENT_INTEGRATION.md  # Full payment API integration guide
│   └── RELATIONAL_DATABASE_COMPLIANCE.md # Relational design notes
├── nginx/                       # Nginx config for Docker deployments
├── .github/workflows/           # CI/CD pipelines
├── render.yaml                  # Render deployment blueprint
├── docker-compose.yml
├── Dockerfile.backend
└── Dockerfile.frontend
```

---

## 5. Git Branching Strategy

See [Branching Strategy](./docs/BRANCHING_STRATEGY.md) for the full workflow guide.

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
- Transactional customer registration with buyer organisation creation
- Transactional supplier registration with compliance document upload and Business Admin verification
- Multi-step bid creation wizard (title, requirements, BoQ, suppliers, deadline, visibility)
- Public bid noticeboard for open/global bids; restricted bids never appear in public discovery
- Invite-only bids require at least one active, verified supplier and enforce invitation access on detail, interest and response routes
- Verified-supplier directory, persisted invitations, targeted notifications, response submission and bidding-fee workflow
- Bid evaluation, award, and order creation with audit trail
- Order status lifecycle: `pending_acceptance → accepted → delivery_in_progress → delivered → completed`

### Finance & Accounting
- AR/AP invoicing with aging, payment recording, reminders, and CSV/PDF export
- **Double-entry ledger** — chart of accounts, journal, trial balance, income statement, balance sheet, cash-flow reporting
- **Escrow** — explicit collection, hold, dispute, release, refund, and failure states; buyer/admin release after fulfillment
- **Mobile money & bank payments** — MTN, Airtel, Zamtel, Bank (see §7)
- Wallet system for supplier bidding fees

### Portals
| Portal | Key Features |
|---|---|
| **Customer Portal** | Responsive requirements, invoices, orders, **Pay Now** (mobile money), escrow funding and digital signatures |
| **Supplier Portal** | Responsive global/invited bid opportunities, compliance verification and document upload, orders, contracts, signatures and notifications |
| **Business Admin** | Full procurement operations, verified-supplier invitation lists, supplier review, bids/orders, invoices, escrow and reports, with mobile navigation, actions and financial metrics |
| **System Admin** | Platform health, organisation oversight, audit logs and unified user maintenance with search, type/status filters, mobile cards and affiliation-aware editing |

### Other
- Near-real-time notifications with 30s polling and mark-as-read
- Two-way customer-care conversations with append-only replies, status tracking, automatic reopening on customer response, and audited resolution notes
- Responsive layouts across all portals, including 320px phone screens, overflow-safe data views and touch-friendly mobile controls
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
5. On success → funds move to `HELD_IN_ESCROW`; no seller payout occurs yet
6. Buyer/admin confirmation starts an asynchronous supplier disbursement
7. Provider-specific callbacks arrive at `/api/webhooks/mtn`, `/airtel`, or `/bank`
8. A reconciliation worker polls transactions still pending after five minutes

**To activate:** Set the required env vars in the Render dashboard (see §15).

---

## 8. Security Model

- **Authentication**: httpOnly, SameSite cookies. Tokens never stored in `localStorage`.
- **Login throttling**: Maximum 10 login requests per IP in each 10-minute window.
- **Identity uniqueness**: Emails are trimmed, lowercased and checked across platform, organisation and supplier account tables while transaction advisory locks serialize concurrent writers.
- **Ambiguous identity safety**: Login, password reset and wallet recipient lookup reject legacy identities that resolve to more than one account.
- **Tenant isolation**: Tenant-owned operations apply authenticated role, ownership and `tenant_id` checks; system-wide and public endpoints use explicit role/visibility rules.
- **CORS**: Restricted to `CORS_ORIGINS` — no wildcard in production.
- **Passwords**: Minimum 10 characters, uppercase + lowercase + number + symbol required.
- **Uploads**: Validated by both MIME type and file extension; random filenames; 10MB limit.
- **Budget isolation**: Customer procurement budgets are never visible to suppliers.
- **Escrow**: Fund/release operations use DB transactions + row-level locks.
- **Ledger**: Journal entries and lines are immutable by design.
- **Signatures**: Record signer identity, consent text, SHA-256 hash, timestamp, IP, user-agent, and write audit log entries.
- **Invite-only access**: Restricted bids validate eligible invitees and deny public discovery or uninvited supplier participation.
- **User maintenance**: System-admin-only edits are audited and protect the primary administrator, self-deactivation and occupied active administrator seats.
- **Admin seats**: Create/reactivation paths enforce one active System Admin and one active Business Admin. Migration `1672531200009` adds a partial unique index when legacy seat data is clean and otherwise defers the constraint for maintenance remediation.
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

Render's free-tier web service does not support a pre-deploy command, so the backend `startCommand` runs migrations immediately before starting the API:
```bash
npm run migrate:up && node src/index.js
```

Recent forward-only compatibility migrations include:

- `1672531200010_support_issue_comments.js` — adds append-only customer-care conversations so reporters and platform administrators can exchange replies without overwriting resolution history.
- `1672531200008_registration_schema_repair.js` — idempotently restores supplier business categories, verification fields, required document definitions and document metadata needed by registration.
- `1672531200009_prepare_platform_admin_active_role_constraint.js` — adds the one-active-admin-per-role index when legacy data is clean, or warns and defers it so conflicting seats can be repaired through System Admin maintenance.

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
cp ../.env.example .env   # fill in DATABASE_URL, JWT_SECRET, etc.
npm run dev
```

**Frontend:**
```bash
cd frontend
npm ci
npm start
```

Requires a local or Docker PostgreSQL 15 instance.

### Validation

Use Node.js 24.14.1 or a compatible Node 24 release. The current validation baseline is **21 backend Jest suites / 126 tests** and **5 frontend suites / 26 tests**, plus a successful production frontend build.

> Backend integration suites reset database tables. Run them only against a disposable, fully migrated test database—not a development or production database containing data you need.

```bash
# Backend (with DATABASE_URL pointing to a disposable migrated test database)
cd backend
npm test -- --runInBand
npm run typecheck:payments
npx eslint src/

# Frontend
cd ../frontend
CI=true npm test -- --runInBand
npm run build

# Repository root
cd ..
docker compose config --quiet
```

---

## 11. CI/CD Pipelines

Workflows live in [`.github/workflows/`](.github/workflows/).

| Workflow | Trigger | Steps |
|---|---|---|
| `ci.yml` | Push to `main` / pull request | Backend install and syntax checks; non-blocking backend Jest run; frontend install/build; Docker Compose validation/image builds; separate non-blocking backend/frontend lint job |
| `pages.yml` | Manual (`workflow_dispatch`) | Build React → deploy to GitHub Pages |
| `cd.yml` | Push to `main` or manual | Validate deploy secrets → SSH into server → fast-forward pull → `docker compose up --build -d` |

Frontend Jest tests are part of the local validation baseline above but are not currently executed by `ci.yml`.

---

## 12. Key API Reference

| Area | Endpoints |
|---|---|
| **Auth** | `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/me` |
| **Registration** | `POST /api/register`, `POST /api/register-supplier`, `GET /api/required-documents`, `POST /api/forgot-password`, `POST /api/reset-password` |
| **Suppliers** | `GET /api/supplier/profile`, `POST /api/supplier/documents`, `GET /api/supplier/verification/status`, `GET /api/suppliers/verified` |
| **Bids** | `GET /api/public/bids`, `GET /api/tenant/bids`, `POST /api/tenants/:tid/bids`, `PUT /api/bids/:bidId/publish`, `POST /api/bids/:bidId/invite`, `GET /api/supplier/bids`, `POST /api/supplier/bids/:bidSupplierId/response` |
| **Requirements** | `POST /api/bids/:bidId/requirements` (upsert) |
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
| **System User Maintenance** | System-admin-only `GET /api/system/users` and `PATCH /api/system/users/:userType/:id`; `userType` is `platform_admin`, `tenant_user` or `supplier_user`, and editable fields are `full_name`, `email` and `is_active` |
| **Admin** | `GET /api/admin/*`, `GET /api/system/*` |

---

## 13. Platform Admin Access

Seeded administrator emails:

| Seat | Email |
|---|---|
| System Admin | `wamuyuwamundia@gmail.com` |
| Business Admin | `brightilunga6@gmail.com` |

Passwords are **never hardcoded**. Set `SYSTEM_ADMIN_PASSWORD` and `BUSINESS_ADMIN_PASSWORD` in the environment before the first production startup or administrator login. Without those values, the seeded rows retain an unusable placeholder password hash.

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
4. Once verified, you appear in bid invitation flows, can discover global bids and can respond to restricted bids when directly invited

---

## 15. Environment Variables

### Core (required in all environments)

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
REDIS_URL=redis://localhost:6379
JWT_SECRET=<64-char hex string>
PAYMENT_DATA_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
PAYMENT_CALLBACK_BASE_URL=https://zambia-procurement-backend.onrender.com
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
MTN_MOMO_ENV=sandbox   # → 'production' when going live
MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY=your_collection_key
MTN_MOMO_COLLECTION_API_USER=your_collection_api_user
MTN_MOMO_COLLECTION_API_KEY=your_collection_api_key
MTN_MOMO_DISBURSEMENT_SUBSCRIPTION_KEY=your_disbursement_key
MTN_MOMO_DISBURSEMENT_API_USER=your_disbursement_api_user
MTN_MOMO_DISBURSEMENT_API_KEY=your_disbursement_api_key
MTN_WEBHOOK_TOKEN=<random-provider-callback-token>

# Airtel Money — register at developers.airtel.africa
AIRTEL_BASE_URL=https://openapiuat.airtel.africa
AIRTEL_CLIENT_ID=your_client_id
AIRTEL_CLIENT_SECRET=your_client_secret
AIRTEL_DISBURSEMENT_PIN=<provider-issued-encrypted-pin>
AIRTEL_WEBHOOK_TOKEN=<random-provider-callback-token>

# Selected bank's bilateral API contract
BANK_API_BASE_URL=https://bank-api.example
BANK_API_KEY=<secret>
BANK_COLLECTION_PATH=/collections
BANK_DISBURSEMENT_PATH=/disbursements
BANK_STATUS_PATH=/transactions/:id
BANK_WEBHOOK_TOKEN=<random-provider-callback-token>

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
