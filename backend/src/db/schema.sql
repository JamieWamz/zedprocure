CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
    role VARCHAR(20) NOT NULL CHECK (role IN ('tenant_admin', 'customer')),
    is_active BOOLEAN NOT NULL DEFAULT true,
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
    is_active BOOLEAN NOT NULL DEFAULT true
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
    created_by UUID NOT NULL REFERENCES tenant_users(id),
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
