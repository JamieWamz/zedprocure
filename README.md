# Freshstart Procurement Portal

Containerized procurement, accounting, invoicing, escrow, and supplier-management platform for Zambian procurement workflows.

The current system has two platform administrator seats:

- System Admin: owns system health, platform oversight, users, organizations, suppliers, audit, and operational visibility.
- Business Admin: owns procurement operations, accounting, invoices, supplier verification, bids, orders, escrow release, and customer/supplier support.

There is no tenant-admin role. Customers and suppliers register organically. Suppliers remain pending until Business Admin verifies them.

## Current Capabilities

- Organic customer registration with buyer organization creation.
- Organic supplier registration with pending verification.
- Supplier compliance document upload and Business Admin verification.
- Verified supplier invitation, bid response, and bidding-fee workflow.
- Customer requirements capture with budget isolation from suppliers.
- Bid creation, award, order tracking, escrow funding, and escrow release.
- AR/AP invoicing, invoice aging, payment recording, reminders, and exports.
- Double-entry ledger, chart of accounts, journal, trial balance, income statement, balance sheet, and cash-flow reporting.
- Paperless digital signatures for invoices and orders with consent text, signer identity, hash, timestamp, IP/user-agent metadata, and audit log entries.
- Customer portal for requirements, invoices, orders, escrow, and signatures.
- Supplier portal for verification status, documents, invitations, awarded orders, invoices, escrow visibility, and signatures.
- Business Admin portal for full procurement and accounting operations.
- System Admin portal for estate-wide monitoring and governance.
- CI/CD via GitHub Actions for syntax checks, frontend build, Docker Compose validation, Docker image build, and manual server deployment.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Ant Design 5, React Router, Axios, Recharts |
| Backend | Node.js 22, Express, httpOnly cookie JWT auth, Multer uploads |
| Database | PostgreSQL 15 with `uuid-ossp` |
| Runtime | Docker Compose |
| Web | Nginx reverse proxy for frontend and `/api` |
| CI/CD | GitHub Actions |

## Container-First Deployment

This application is intended to run as containers.

1. Create a root `.env` file:

```env
JWT_SECRET=<generate-with-openssl-rand-hex-32>
CORS_ORIGINS=http://localhost,http://your-domain.example
COOKIE_SECURE=false
SYSTEM_ADMIN_PASSWORD=<strong-password>
BUSINESS_ADMIN_PASSWORD=<strong-password>
```

For HTTPS production, set:

```env
COOKIE_SECURE=true
CORS_ORIGINS=https://your-domain.example
```

2. Build and run:

```bash
docker compose up --build
```

3. Open:

- Frontend: `http://localhost`
- Backend API: `http://localhost:4000`

The backend container initializes the database on startup, updating admin passwords from environment variables and ensuring chart of accounts exist.

## Platform Admin Access

Seeded platform admin emails:

| Seat | Email |
| --- | --- |
| System Admin | `wamuyuwamundia@gmail.com` |
| Business Admin | `brightilunga6@gmail.com` |

Passwords are never hardcoded. Set `SYSTEM_ADMIN_PASSWORD` and `BUSINESS_ADMIN_PASSWORD` before first startup. If omitted, strong random passwords are generated and printed once in the backend logs; store them securely.
## Organic Onboarding

Customers:

- Register from the login page as `Customer / Buyer`.
- A buyer organization is created from the supplied organization details.
- Customers can submit requirements, track invoices, fund escrow, view orders, and sign documents digitally.

Suppliers:

- Register from the login page as `Supplier`.
- Supplier records start with `pending` verification and `is_active=false`.
- Suppliers upload compliance documents from the supplier portal.
- Business Admin verifies or rejects suppliers.
- Only verified suppliers appear in bid invitation flows.

## Security

- Authentication uses httpOnly, SameSite cookies. Tokens are not stored in localStorage.
- Production requires a strong `JWT_SECRET`.
- CORS is restricted with `CORS_ORIGINS`.
- Set `COOKIE_SECURE=true` only when serving over HTTPS.
- Password validation requires at least 10 characters with uppercase, lowercase, number, and symbol.
- Uploads are limited to approved document/image MIME types and extensions with random filenames.
- Procurement budgets are hidden from supplier views.
- Escrow funding/release and payment confirmation use database transactions and row locks.
- Journal entries and journal lines are immutable by design.
- Digital signatures record signer identity, consent, timestamp, hash, IP/user-agent metadata, and audit events.
- Only one active System Admin seat and one active Business Admin seat are allowed.
- Do not commit `.env`, private keys, database dumps, or uploaded files.

Recommended production hardening:

- Put Nginx or a cloud load balancer with TLS in front of the stack.
- Use managed PostgreSQL or encrypted Docker volumes with backups.
- Rotate `JWT_SECRET` and admin passwords per environment.
- Configure SMTP credentials outside Git for invoice/reminder/reset emails.
- Restrict SSH deployment keys to the deployment host and repository.
- Run dependency and image scanning in your GitHub security settings.

## CI/CD

Workflows live in `.github/workflows`.

`ci.yml` runs on pull requests and pushes to `main`:

- Install backend dependencies with `npm ci`.
- Run `node --check` across backend source.
- Install frontend dependencies with `npm ci`.
- Build the frontend.
- Validate Docker Compose.
- Build Docker images.

`pages.yml` deploys the static React frontend to GitHub Pages:

- Install frontend dependencies with `npm ci`.
- Build the frontend.
- Upload and deploy the `frontend/build` artifact to Pages.

GitHub Pages cannot run the Express API or PostgreSQL database. If you use Pages for the frontend, configure a repository/environment variable named `REACT_APP_API_BASE_URL` with the public URL of the deployed backend, for example:

```text
https://api.your-domain.example
```

`cd.yml` is manual (`workflow_dispatch`) and deploys via SSH once you configure GitHub environment secrets:

| Secret | Purpose |
| --- | --- |
| `DEPLOY_HOST` | Server hostname or IP |
| `DEPLOY_USER` | SSH user |
| `DEPLOY_SSH_KEY` | Private SSH key for deploy |
| `DEPLOY_PATH` | Existing repo path on the server |

The CD command runs:

```bash
git pull --ff-only origin main
docker compose up --build -d
```

## Local Development

Containerized development is preferred, but local development is available.

Backend:

```bash
cd backend
npm ci
npm run dev
```

Frontend:

```bash
cd frontend
npm ci
npm start
```

Use Docker or a local PostgreSQL 15 database. For non-Docker backend development, provide `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, and `COOKIE_SECURE` in your local environment.

## Key API Areas

| Area | Endpoints |
| --- | --- |
| Auth | `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/me` |
| Registration | `/api/register`, `/api/forgot-password`, `/api/reset-password` |
| Business/System Admin | `/api/admin/*`, `/api/system/*` |
| Suppliers | `/api/supplier/profile`, `/api/supplier/documents`, `/api/admin/suppliers/pending`, `/api/admin/suppliers/:id/verify` |
| Bids | `/api/tenants/:tid/bids`, `/api/tenant/bids`, `/api/bids/:bidId`, `/api/public/bids` |
| Orders | `/api/orders`, `/api/bids/:bidId/award` |
| Escrow | `/api/escrow/fund`, `/api/escrow/release` |
| Invoices | `/api/invoices`, `/api/invoices/summary`, `/api/invoices/aging`, `/api/invoices/:id/payments` |
| Ledger | `/api/ledger/accounts`, `/api/ledger/journal`, `/api/ledger/trial-balance`, `/api/ledger/income-statement`, `/api/ledger/balance-sheet`, `/api/ledger/cash-flow` |
| Signatures | `/api/signatures/:documentType/:documentId`, `/api/signatures` |

## Repository Structure

```text
zambia-procurement/
├── backend/
│   └── src/
│       ├── config/
│       ├── db/
│       ├── middleware/
│       ├── routes/
│       ├── services/
│       └── utils/
├── frontend/
│   └── src/
│       ├── components/
│       ├── context/
│       ├── App.js
│       └── index.js
├── nginx/
├── .github/workflows/
├── docker-compose.yml
├── Dockerfile.backend
└── Dockerfile.frontend
```

## License

Internal use.
