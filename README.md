# Freshstart Procurement Portal

B2B SaaS procurement platform tailored to the Zambian Public Procurement Act. Enables tenant organizations to publish open bids, invite verified suppliers, collect responses, manage orders, and process payments through an escrow-backed workflow with immutable ledger accounting.

## Features

- Multi-tenant procurement with tenant-scoped bid creation
- Supplier verification workflow with document uploads
- Open bid invitation and supplier response collection
- Order awarding and escrow funding/release
- Bidding fee payments with idempotent confirmation
- Double-entry immutable general ledger
- Role-based access: system admin, business admin, tenant admin, customer, supplier
- Price isolation: budget amounts hidden from suppliers
- Audit logging for admin actions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Ant Design 5, Axios, React Router 6 |
| Backend | Node.js, Express, httpOnly-cookie JWT auth, Multer uploads |
| Database | PostgreSQL 15 with `uuid-ossp` |
| Infrastructure | Docker Compose, Nginx |

## Prerequisites

- Node.js >= 18
- PostgreSQL 15
- npm or yarn

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/JamieWamz/zedprocure.git
cd zambia-procurement
```

### 2. Start PostgreSQL

Ensure PostgreSQL is running locally:

```bash
# Ubuntu/Debian
sudo systemctl start postgresql

# macOS (Homebrew)
brew services start postgresql
```

### 3. Configure environment variables

Copy `.env.example` to `.env` (backend and root) and fill in real values. Generate a strong secret:

```bash
openssl rand -hex 32
```

`backend/.env` (used for local non-Docker dev):

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/zambia_procurement
JWT_SECRET=<generated-secret>
PORT=4000
NODE_ENV=development
CORS_ORIGINS=http://localhost:3000,http://localhost
COOKIE_SECURE=false
```

Never commit `.env` files — they are gitignored.

### 4. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 5. Initialize the database

```bash
cd backend
npm run seed
```

This creates the schema and seeds default users and verified suppliers.

### 6. Start the backend

```bash
cd backend
npm run dev
```

Backend runs at `http://localhost:4000`.

### 7. Start the frontend (new terminal)

```bash
cd frontend
npm start
```

Frontend runs at `http://localhost:3000`.

## Docker

```bash
docker-compose up --build
```

- Frontend: `http://localhost`
- Backend: `http://localhost:4000`

Requires `JWT_SECRET` to be set in the root `.env` (Docker Compose substitutes it). The backend container runs the seed on startup to initialize the database. Generate one with `openssl rand -hex 32` and place it in `.env`.

## Accessing From Another PC (LAN)

The app is ready to run on your machine and be reached from another computer on the same network.

**Docker (recommended):**
The compose stack already exposes the frontend on port `80` and the backend on `4000`. From the other PC, open `http://<this-machine-ip>` (nginx proxies `/api` to the backend, so no extra setup is needed). Find your IP with `hostname -I` (Linux) or `ipconfig` (Windows).

**Dev servers (CRA + Node):**
1. Set the frontend to bind on all interfaces: `frontend/.env` already contains `HOST=0.0.0.0`.
2. Start the backend (`npm run dev`) and frontend (`npm start`) as usual.
3. On the other PC open `http://<this-machine-ip>:3000`. The CRA dev server proxies `/api` → `localhost:4000` automatically.

Ensure the host firewall allows the relevant ports (`80`/`4000` for Docker, `3000`/`4000` for dev).

> LAN access runs over plain HTTP. Do **not** expose this setup to the public internet without TLS — see Security below.

## Security Notes

- Auth uses **httpOnly, SameSite cookies** (not `localStorage`), which removes the XSS token-theft vector.
- `JWT_SECRET` must be set and unique per environment; the backend refuses to start in `NODE_ENV=production` without it.
- CORS is restricted to `CORS_ORIGINS`; the previous open `*` policy is gone.
- Escrow funding/release and bidding-fee confirmation run inside serializable DB transactions (`SELECT … FOR UPDATE`) to prevent double-spend races.
- All password creation/update enforces a strength policy (≥10 chars, mixed case, number, symbol).
- File uploads are validated by extension **and** MIME type, with cryptographically random filenames.
- **Before any internet exposure:** terminate TLS (the cookie is only `Secure` when `COOKIE_SECURE=true`) and use real secrets, not the LAN defaults.

## Default Accounts

The seed creates the following accounts. **Passwords are no longer hardcoded.** On first seed, a strong random password is generated for each and printed to the server log — copy and store them securely. Alternatively, set `SYSTEM_ADMIN_PASSWORD` / `BUSINESS_ADMIN_PASSWORD` (Docker) before seeding to choose them.

| Role | Email |
|------|-------|
| System Admin (immutable) | `wamuyuwamundia@gmail.com` |
| Business Admin | `brightilunga6@gmail.com` |
| Tenant Admin | `tenantadmin@works.gov.zm` |
| Customer | `customer@works.gov.zm` |
| Supplier 1–3 | `supplier1@builders.zm`, `supplier2@engineering.zm`, `supplier3@traders.zm` |

> Set your own System Admin password via `SYSTEM_ADMIN_PASSWORD` and sign in with that email.

## Project Structure

```
zambia-procurement/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── auth.js           # JWT configuration
│   │   │   └── db.js             # PostgreSQL connection pool
│   │   ├── db/
│   │   │   ├── schema.sql        # Full database schema
│   │   │   └── seed.js           # Initial data seeding
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js # JWT authentication + role checks
│   │   │   └── priceIsolation.js # Strips budget from supplier responses
│   │   ├── routes/
│   │   │   ├── auth.js           # Login endpoint
│   │   │   ├── admin.js          # Admin user management
│   │   │   ├── system.js         # System admin + console
│   │   │   ├── tenant.js         # Tenant CRUD + bid listing
│   │   │   ├── bid.js            # Bid lifecycle + supplier responses
│   │   │   ├── order.js          # Order awarding
│   │   │   ├── payment.js        # Bidding fee payments
│   │   │   ├── escrow.js         # Escrow funding and release
│   │   │   ├── ledger.js         # General ledger reads
│   │   │   ├── supplier.js       # Supplier verification + docs
│   │   │   ├── supplierList.js   # Verified supplier listing
│   │   │   ├── requirement.js    # Customer bid requirements
│   │   │   └── tenant.js         # Tenant-scoped operations
│   │   ├── services/
│   │   │   └── ledgerService.js  # Journal entry creation
│   │   └── index.js              # Express app entry point
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/           # Page-level React components
│   │   ├── context/
│   │   │   └── AuthContext.js    # Global auth state + axios interceptors
│   │   ├── App.js                # Router and route guards
│   │   └── index.js
│   └── package.json
├── docker-compose.yml
├── Dockerfile.backend
├── Dockerfile.frontend
└── nginx/
    └── nginx.conf                # Reverse proxy for frontend + API
```

## API Overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | No | Login, sets httpOnly auth cookies |
| POST | `/api/auth/refresh` | Cookie | Rotate expired access token |
| POST | `/api/auth/logout` | Cookie | Clear auth cookies |
| GET | `/api/me` | Cookie | Current user profile + dashboard route |
| GET | `/api/admin/health` | System Admin | Database health check |
| POST | `/api/admin/admins` | System Admin | Create admin user |
| PUT | `/api/system/admins/:id` | System Admin | Update admin |
| DELETE | `/api/system/admins/:id` | System Admin | Deactivate admin |
| POST | `/api/admin/tenants` | Admin | Create tenant |
| GET | `/api/admin/tenants` | Admin | List tenants |
| POST | `/api/admin/tenant-users` | Admin | Create tenant user |
| POST | `/api/admin/suppliers` | Admin | Create supplier |
| PUT | `/api/admin/suppliers/:id/verify` | Admin | Verify/reject supplier |
| POST | `/api/tenants/:tid/bids` | Admin | Create bid (min 3 suppliers) |
| GET | `/api/tenant/bids` | Admin | List tenant bids |
| GET | `/api/bids/:bidId` | Auth | Get bid details |
| POST | `/api/bids/:bidId/requirements` | Customer | Submit requirements |
| POST | `/api/bids/:bidId/award` | Admin | Award bid, create order |
| GET | `/api/supplier/bids` | Supplier | List open invitations |
| POST | `/api/supplier/bids/:id/respond` | Supplier | Accept/decline invitation |
| POST | `/api/supplier/documents` | Supplier | Upload compliance docs |
| POST | `/api/payments/bidding-fee` | Supplier | Initiate fee payment |
| POST | `/api/payments/confirm` | Auth | Confirm payment |
| POST | `/api/escrow/fund` | Customer | Fund escrow |
| POST | `/api/escrow/release` | Admin | Release escrow |
| GET | `/api/ledger/accounts` | Business Admin | Chart of accounts |
| GET | `/api/ledger/journal` | Business Admin | Journal entries |
| GET | `/api/public/bids` | No | Public bid noticeboard |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `JWT_SECRET` | Yes | - | JWT signing secret (generate with `openssl rand -hex 32`) |
| `PORT` | No | `4000` | Backend port |
| `NODE_ENV` | No | `development` | Set `production` to enforce required secrets |
| `CORS_ORIGINS` | No | `http://localhost:3000,http://localhost` | Comma-separated allowed browser origins |
| `COOKIE_SECURE` | No | `false` | Set `true` only when serving over HTTPS |
| `SYSTEM_ADMIN_PASSWORD` | No | generated | System Admin password on first seed |
| `BUSINESS_ADMIN_PASSWORD` | No | generated | Business Admin password on first seed |

## Scripts

### Backend

```bash
npm run dev     # Start with nodemon
npm start       # Production start
npm run seed    # Seed database
npx jest        # Run tests
```

### Frontend

```bash
npm start       # Development server
npm run build   # Production build
```

## Database Schema

Key tables:
- `platform_admins` — System and business administrators
- `tenants` — Procurement organizations
- `tenant_users` — Admin and customer accounts
- `suppliers` — Verified supplier records
- `supplier_users` — Supplier login accounts
- `bids` — Procurement opportunities
- `bid_suppliers` — Invitations linking bids to suppliers
- `bid_requirements` — Customer requirements/budgets
- `supplier_responses` — Supplier technical proposals
- `orders` — Awarded contracts
- `escrow_accounts` — Escrow balances
- `payment_transactions` — Payment records
- `journal_entries` / `journal_lines` — Immutable general ledger
- `audit_log` — Admin action audit trail

## License

Internal use.
