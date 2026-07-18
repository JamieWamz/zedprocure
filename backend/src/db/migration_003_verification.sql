-- Migration: Automated Supplier Verification Engine
-- Adds tables for PACRA, ZRA and document-level verification results

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Supplier verification runs: each run triggers checks against external APIs
CREATE TABLE IF NOT EXISTS supplier_verification_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    triggered_by UUID, -- platform_admin id who triggered, NULL if automated
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    overall_status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
        CHECK (overall_status IN ('in_progress','passed','failed','partial')),
    completed_at TIMESTAMPTZ,
    summary JSONB -- human-readable summary of all checks
);

-- Individual check results for each verification run
CREATE TABLE IF NOT EXISTS supplier_verification_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES supplier_verification_runs(id) ON DELETE CASCADE,
    check_type VARCHAR(50) NOT NULL, -- 'pacra_company', 'pacra_directors', 'zra_tpin', 'zra_tax_clearance', 'zra_vat', 'document_validation', etc.
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','in_progress','passed','failed','error','skipped')),
    score DECIMAL(5,2), -- 0.00 to 100.00
    details JSONB, -- full API response or validation details
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT
);

-- Document-level verification results
CREATE TABLE IF NOT EXISTS supplier_document_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES supplier_documents(id) ON DELETE CASCADE,
    run_id UUID NOT NULL REFERENCES supplier_verification_runs(id) ON DELETE CASCADE,
    check_type VARCHAR(50) NOT NULL, -- e.g. 'format_check', 'content_check', 'expiry_check', 'authority_verify'
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','in_progress','passed','failed','error','skipped')),
    details JSONB,
    verified_at TIMESTAMPTZ
);

-- Add verification columns to supplier_documents table
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='supplier_documents' AND column_name='document_type_category') THEN
        ALTER TABLE supplier_documents ADD COLUMN document_type_category VARCHAR(50);
    END IF;
END $$;

-- Add document expiry tracking
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='supplier_documents' AND column_name='expiry_date') THEN
        ALTER TABLE supplier_documents ADD COLUMN expiry_date DATE;
    END IF;
END $$;

-- Add document metadata (issuing authority, reference number, etc.)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='supplier_documents' AND column_name='metadata') THEN
        ALTER TABLE supplier_documents ADD COLUMN metadata JSONB;
    END IF;
END $$;

-- Add columns to suppliers table for additional verification data
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='suppliers' AND column_name='tpin') THEN
        ALTER TABLE suppliers ADD COLUMN tpin VARCHAR(20);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='suppliers' AND column_name='vat_number') THEN
        ALTER TABLE suppliers ADD COLUMN vat_number VARCHAR(20);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='suppliers' AND column_name='last_verified_at') THEN
        ALTER TABLE suppliers ADD COLUMN last_verified_at TIMESTAMPTZ;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='suppliers' AND column_name='verification_score') THEN
        ALTER TABLE suppliers ADD COLUMN verification_score DECIMAL(5,2);
    END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_supplier_verification_runs_supplier 
    ON supplier_verification_runs(supplier_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_verification_checks_run 
    ON supplier_verification_checks(run_id, check_type);
CREATE INDEX IF NOT EXISTS idx_supplier_document_verifications_document 
    ON supplier_document_verifications(document_id);
CREATE INDEX IF NOT EXISTS idx_supplier_document_verifications_run 
    ON supplier_document_verifications(run_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_tpin 
    ON suppliers(tpin) WHERE tpin IS NOT NULL;