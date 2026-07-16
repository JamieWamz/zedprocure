# Zambia Procurement System — Agent Implementation Log

## Session 1: Frontend Build & Deployment Infrastructure Fixes

- [x] **Resolve frontend compiler/immer error**
  - Added `immer@^11.1.11` to `dependencies` and `overrides` block in `frontend/package.json`
  - Forces all nested packages (`@reduxjs/toolkit`, `recharts`) to resolve the same version
  - Verified: `npm run build` compiles successfully with no errors

- [x] **Align database migration setup**
  - Created `backend/src/db/migrations/` directory
  - Moved initial migration script to `backend/src/db/migrations/1672531200000_initial_schema.js`
  - Migration references legacy SQL files: `schema.sql`, `migration_002_production.sql`, `migration_003_verification.sql`, `migration_004_manual_verification.sql`
  - Added `"migrate:up": "node-pg-migrate --config-file pg-migrate-config.js up"` to `backend/package.json`

- [x] **Configure Docker and Render deployment setup**
  - Updated `render.yaml`: moved migration from `buildCommand` to `preDeployCommand` (DB not accessible at build time on Render)
  - Updated `docker-compose.yml`: removed duplicate `schema.sql` volume mount; backend container command now runs `npm run migrate:up && node src/index.js`

- [x] **Verification**
  - `docker compose config --quiet` passes with no errors
  - Frontend production build compiles cleanly

---

## Session 2: Full System Audit & Bug Fixes

### Bug Fixes

- [x] **`backend/src/routes/registration.js` — NULL registration_number ON CONFLICT crash**
  - **Root cause:** PostgreSQL unique constraints don't match NULL values (`NULL != NULL`), so `ON CONFLICT (registration_number)` never fires for users who register without a registration number, silently creating duplicate tenants.
  - **Fix:** Split the tenant INSERT into two branches — use `ON CONFLICT` only when `registration_number` is provided; use a plain `INSERT INTO tenants (id, name)` when it is null.

- [x] **`backend/src/routes/ledger.js` — LIMIT/OFFSET parameter index undefined evaluation order**
  - **Root cause:** `LIMIT $${i++} OFFSET $${i++}` in a single template literal expression has undefined evaluation order for the two `i++` post-increment side-effects across JavaScript engines.
  - **Fix:** Capture `const limitIdx = i++; const offsetIdx = i++;` before the query string is built, then use `$${limitIdx}` and `$${offsetIdx}` explicitly.

- [x] **`backend/src/routes/requirement.js` — Missing try/catch (unhandled promise rejection)**
  - **Root cause:** The entire route body had no `try/catch`, meaning any DB error (connection timeout, constraint violation) would propagate as an unhandled rejection and potentially crash the process.
  - **Fix:** Wrapped all queries in try/catch; DB errors now return a clean HTTP 500.

- [x] **`backend/src/routes/supplierList.js` — Missing try/catch (unhandled promise rejection)**
  - Same issue as requirement.js — no error handling at all.
  - **Fix:** Wrapped query in try/catch; added `ORDER BY company_name` for consistent output.

- [x] **`backend/src/routes/dashboard.js` — Inline `require('crypto')` inside request handlers**
  - **Root cause:** `require('crypto').randomUUID()` was called inline inside route handler bodies — not a crash, but a code smell and minor performance overhead on every request.
  - **Fix:** Added `const crypto = require('crypto')` at the top of the file; replaced all inline calls.

### Infrastructure & Deployment Improvements

- [x] **`backend/uploads/` — Directory not tracked by git**
  - **Root cause:** Git does not track empty directories. On a fresh `git clone`, `backend/uploads/` would not exist, and `multer` would crash when trying to save uploaded files.
  - **Fix:** Created `backend/uploads/.gitkeep` so the directory is preserved in version control.

- [x] **`backend/src/db/init.js` — Programmatic uploads directory creation**
  - **Fix:** Added `fs.mkdirSync(uploadsDir, { recursive: true })` at startup so the directory is always created, even in Docker environments where the build context might not include it.

- [x] **`docker-compose.yml` — Missing `APP_URL`, broken `COOKIE_SECURE` default, no JWT_SECRET fallback**
  - `COOKIE_SECURE` default was `true` which breaks local HTTP login (cookies with `Secure` flag aren't sent over plain HTTP).
  - **Fix:** Changed `COOKIE_SECURE` default to `false` for local docker-compose; added JWT_SECRET placeholder fallback so the server doesn't crash when running locally without an `.env`; added `APP_URL` env var for email link generation.

- [x] **`render.yaml` — Frontend static site not defined**
  - **Root cause:** `render.yaml` only declared the backend web service. The React frontend had no Render service definition, meaning it would not be provisioned by Blueprint deploys.
  - **Fix:** Added a `type: static` service named `zedprocure` pointing to `frontend/`, building with `npm install && npm run build`, publishing `build/`, with SPA rewrite rules. Also added `REACT_APP_API_BASE_URL` env var pointing to the backend Render URL.

- [x] **`render.yaml` — Missing `APP_URL` env var on backend service**
  - **Fix:** Added `APP_URL: https://zedprocure.onrender.com` to the backend service env vars so email links work correctly in production.

---

## System Architecture Reference

| Component | Technology | Notes |
|---|---|---|
| Frontend | React (CRA) | Ant Design UI, React Router v6, axios, recharts |
| Backend | Express.js (Node) | JWT auth, cookie-based sessions, multer file uploads |
| Database | PostgreSQL 15 | Managed by node-pg-migrate; schema in `backend/src/db/` |
| Auth | JWT (access + refresh tokens) | Short-lived access token, longer-lived refresh token, httpOnly cookies |
| File Storage | Local disk (`backend/uploads/`) | Multer; for production consider S3/R2 migration |
| Deployment (PaaS) | Render | Backend: web service; Frontend: static site; DB: managed Postgres |
| Deployment (Docker) | Docker Compose | Backend + Frontend (Nginx proxy) + Postgres |
| Financial Ledger | Double-entry bookkeeping | `journal_entries` + `journal_lines` + `accounts` tables |
| Supplier Verification | Manual (Business Admin) | PACRA/ZRA document upload → admin review → approve/reject |

---

## Files Changed

| File | Change |
|---|---|
| `frontend/package.json` | immer override fix |
| `backend/package.json` | migrate:up script |
| `backend/src/db/migrations/1672531200000_initial_schema.js` | Created (migrated from root) |
| `backend/src/db/init.js` | Programmatic uploads dir creation |
| `backend/src/routes/registration.js` | NULL registration_number ON CONFLICT fix |
| `backend/src/routes/ledger.js` | LIMIT/OFFSET parameter index fix |
| `backend/src/routes/requirement.js` | Added try/catch error handling |
| `backend/src/routes/supplierList.js` | Added try/catch + ORDER BY |
| `backend/src/routes/dashboard.js` | Moved crypto require to top-level |
| `backend/uploads/.gitkeep` | Created to track directory in git |
| `docker-compose.yml` | COOKIE_SECURE, JWT_SECRET fallback, APP_URL, migrate command |
| `render.yaml` | Added frontend static service, APP_URL backend env var |
