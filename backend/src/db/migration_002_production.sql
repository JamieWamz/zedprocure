-- Migration: Production readiness — password reset, invitations, wallet, audit
-- Run after schema.sql on existing databases.

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  user_type VARCHAR(32) NOT NULL,
  token VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, user_type)
);

-- Invitations
CREATE TABLE IF NOT EXISTS invitations (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  tenant_id UUID REFERENCES tenants(id),
  supplier_id UUID REFERENCES suppliers(id),
  token VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted BOOLEAN NOT NULL DEFAULT false,
  invited_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- In-app wallet accounts (one per user)
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  user_type VARCHAR(32) NOT NULL,
  balance DECIMAL(14,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Wallet transactions
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY,
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  type VARCHAR(32) NOT NULL CHECK (type IN ('deposit','withdrawal','transfer_in','transfer_out','payment','refund')),
  amount DECIMAL(14,2) NOT NULL,
  balance_before DECIMAL(14,2) NOT NULL,
  balance_after DECIMAL(14,2) NOT NULL,
  reference VARCHAR(128),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add created_at to tenants if missing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='created_at') THEN
    ALTER TABLE tenants ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

-- Add is_active to tenant_users if missing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenant_users' AND column_name='is_active') THEN
    ALTER TABLE tenant_users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- Tenant admins have been retired. Business Admin owns organization/customer operations.
UPDATE tenant_users SET role = 'customer' WHERE role = 'tenant_admin';

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tenant_users' AND constraint_name = 'tenant_users_role_check'
  ) THEN
    ALTER TABLE tenant_users DROP CONSTRAINT tenant_users_role_check;
  END IF;
END $$;

ALTER TABLE tenant_users ALTER COLUMN role SET DEFAULT 'customer';
ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_role_check CHECK (role IN ('customer')) NOT VALID;
ALTER TABLE tenant_users VALIDATE CONSTRAINT tenant_users_role_check;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id, user_type);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created ON wallet_transactions(created_at DESC);

-- Add journal approval flag (used by financial reports / dashboard)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='journal_entries' AND column_name='approved') THEN
    ALTER TABLE journal_entries ADD COLUMN approved BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- Invoicing (AR / AP)
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_no VARCHAR(40) UNIQUE NOT NULL,
    type VARCHAR(4) NOT NULL CHECK (type IN ('AR','AP')),
    party_type VARCHAR(20) NOT NULL DEFAULT 'external'
        CHECK (party_type IN ('customer','supplier','external')),
    party_id UUID,
    party_name VARCHAR(255) NOT NULL,
    party_email VARCHAR(255),
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    bid_id UUID REFERENCES bids(id) ON DELETE SET NULL,
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','sent','partially_paid','paid','overdue','cancelled')),
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'ZMW',
    notes TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
    amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    line_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoice_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount DECIMAL(15,2) NOT NULL,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    method VARCHAR(20) NOT NULL DEFAULT 'bank_transfer'
        CHECK (method IN ('mobile_money','bank_transfer','wallet','cash')),
    reference VARCHAR(128),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(type);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);

-- ─── Digital signatures: paperless invoice/order approvals ─────────────────
CREATE TABLE IF NOT EXISTS digital_signatures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_type VARCHAR(30) NOT NULL CHECK (document_type IN ('invoice','order','bid')),
    document_id UUID NOT NULL,
    signer_user_id UUID NOT NULL,
    signer_user_type VARCHAR(32) NOT NULL,
    signer_role VARCHAR(32),
    signer_email VARCHAR(255),
    signer_name VARCHAR(150) NOT NULL,
    signer_title VARCHAR(120),
    signature_hash VARCHAR(128) UNIQUE NOT NULL,
    consent_text TEXT NOT NULL,
    ip_address INET,
    user_agent TEXT,
    signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_type, document_id, signer_user_id, signer_user_type)
);

CREATE INDEX IF NOT EXISTS idx_digital_signatures_document
  ON digital_signatures(document_type, document_id);
