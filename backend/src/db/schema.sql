CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Platform admin default passwords (change on first login)
-- System Admin: wamuyuwamundia@gmail.com / Mundia J Wamuyuwa
-- Business Admin: brightilunga6@gmail.com / Bright Ilunga
-- Passwords are set via environment variables: SYSTEM_ADMIN_PASSWORD, BUSINESS_ADMIN_PASSWORD
CREATE TABLE platform_admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('system_admin', 'business_admin')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default platform admins (passwords from env or placeholder)
-- These will be updated by the application on startup if env vars are set
INSERT INTO platform_admins (email, password_hash, full_name, role) VALUES
    ('wamuyuwamundia@gmail.com', '$2b$12$placeholder_hash_change_me', 'Mundia J Wamuyuwa', 'system_admin'),
    ('brightilunga6@gmail.com', '$2b$12$placeholder_hash_change_me', 'Bright Ilunga', 'business_admin')
ON CONFLICT (email) DO NOTHING;

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    registration_number VARCHAR(100) UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login TIMESTAMPTZ,
    UNIQUE (tenant_id, email)
);

CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL,
    registration_number VARCHAR(100) UNIQUE,
    verification_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending','documents_submitted','verified','rejected')),
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE supplier_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'supplier_user',
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login TIMESTAMPTZ
);

CREATE TABLE supplier_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    document_type VARCHAR(50) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    upload_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    verification_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    verified_by UUID REFERENCES platform_admins(id),
    verified_at TIMESTAMPTZ
);

CREATE TABLE bids (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    deadline TIMESTAMPTZ NOT NULL,
    delivery_start TIMESTAMPTZ,
    delivery_end TIMESTAMPTZ,
    requires_large_contract BOOLEAN NOT NULL DEFAULT false,
    evaluation_method VARCHAR(20) DEFAULT 'lowest_price' CHECK (evaluation_method IN ('lowest_price','best_value')),
    bidding_fee_amount DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','open','evaluation','awarded','closed')),
    views_count INTEGER NOT NULL DEFAULT 0,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bid_suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id UUID NOT NULL REFERENCES bids(id),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted BOOLEAN,
    accepted_at TIMESTAMPTZ,
    UNIQUE (bid_id, supplier_id)
);

CREATE TABLE bid_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id UUID NOT NULL REFERENCES bids(id),
    customer_user_id UUID NOT NULL REFERENCES tenant_users(id),
    budget_amount DECIMAL(15,2),
    expected_delivery_time INTERVAL,
    payment_method VARCHAR(50),
    certification_standards TEXT,
    specifications_file_path VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE supplier_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_supplier_id UUID NOT NULL REFERENCES bid_suppliers(id),
    product_specifications TEXT,
    terms_conditions_accepted BOOLEAN,
    response_file_path VARCHAR(500),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id UUID NOT NULL REFERENCES bids(id),
    awarded_supplier_id UUID NOT NULL REFERENCES suppliers(id),
    total_amount DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending_acceptance'
        CHECK (status IN ('pending_acceptance','accepted','delivery_in_progress',
                          'delivered','completed','disputed')),
    contract_file_path VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE digital_signatures (
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

CREATE INDEX IF NOT EXISTS idx_digital_signatures_document ON digital_signatures(document_type, document_id);

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_code VARCHAR(20) UNIQUE NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense'))
);

CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    reference_type VARCHAR(50) NOT NULL,
    reference_id UUID,
    description TEXT,
    created_by UUID NOT NULL,
    approved BOOLEAN NOT NULL DEFAULT true,
    is_reversal BOOLEAN NOT NULL DEFAULT false,
    reversed_entry_id UUID REFERENCES journal_entries(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE journal_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    debit DECIMAL(15,2) NOT NULL DEFAULT 0,
    credit DECIMAL(15,2) NOT NULL DEFAULT 0,
    CHECK (debit >= 0 AND credit >= 0),
    CHECK (debit = 0 OR credit = 0)
);
REVOKE UPDATE, DELETE ON journal_entries FROM PUBLIC;
REVOKE UPDATE, DELETE ON journal_lines FROM PUBLIC;

CREATE TABLE escrow_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID UNIQUE REFERENCES orders(id),
    customer_user_id UUID NOT NULL REFERENCES tenant_users(id),
    amount DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending_funding'
        CHECK (status IN ('pending_funding','funded','released','refunded')),
    funded_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ
);

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID NOT NULL,
    actor_type VARCHAR(20) NOT NULL,
    actor_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id UUID,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id UUID,
    to_user_id UUID,
    amount DECIMAL(15,2) NOT NULL,
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('mobile_money','bank_transfer')),
    transaction_ref VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(30) NOT NULL CHECK (type IN ('bidding_fee','escrow_funding','payout','refund')),
    status VARCHAR(20) NOT NULL DEFAULT 'initiated',
    gateway_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── In-app Wallet ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    user_type VARCHAR(32) NOT NULL,
    balance DECIMAL(14,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, user_type)
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    type VARCHAR(32) NOT NULL CHECK (type IN ('deposit','withdrawal','transfer_in','transfer_out','payment','refund')),
    amount DECIMAL(14,2) NOT NULL,
    balance_before DECIMAL(14,2) NOT NULL,
    balance_after DECIMAL(14,2) NOT NULL,
    reference VARCHAR(128),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Invoicing (AR / AP) ──────────────────────────────────────────────────────
CREATE TABLE invoices (
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

CREATE TABLE invoice_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
    amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    line_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE invoice_payments (
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

-- ─── System Logs: immutable audit trail ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID,
    actor_type VARCHAR(32),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    metadata JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE UPDATE, DELETE ON system_logs FROM PUBLIC;

CREATE INDEX IF NOT EXISTS idx_system_logs_entity ON system_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at DESC);

-- ─── Notifications: in-app notification queue ───────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    user_type VARCHAR(32) NOT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    link VARCHAR(500),
    metadata JSONB,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications(user_id, user_type, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created
    ON notifications(created_at DESC);
