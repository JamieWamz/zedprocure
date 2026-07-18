-- ============================================================================
-- Migration 006: BoQ Bid Structure & Enhanced Supplier Verification
-- Adds Bill of Quantities line items, Incoterms, technical specs,
-- verified_date, document_category, and verification_notes.
-- NOTE: document_category and verification_notes were first added in
-- migration_004 with different types (VARCHAR(50) and VARCHAR(20) CHECK).
-- This migration uses IF NOT EXISTS to avoid conflicts and adds a
-- supplementary category option.
-- ============================================================================

-- ─── Bill of Quantities: line items for structured bids ─────────────────────
CREATE TABLE IF NOT EXISTS bid_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
    item_description TEXT NOT NULL,
    unit_of_measure VARCHAR(20) NOT NULL CHECK (unit_of_measure IN (
        'each','kg','g','ton','meters','cm','liters','ml','sqm','sqft',
        'hours','days','months','lump_sum','boxes','pairs','sets'
    )),
    quantity DECIMAL(15,4) NOT NULL CHECK (quantity > 0),
    unit_price_estimate DECIMAL(15,2),
    line_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bid_line_items_bid ON bid_line_items(bid_id);

-- ─── Bids: add Incoterms and technical specifications ───────────────────────
ALTER TABLE bids ADD COLUMN IF NOT EXISTS delivery_terms VARCHAR(10)
    CHECK (delivery_terms IN ('EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DPU','DAP','DDP'));

ALTER TABLE bids ADD COLUMN IF NOT EXISTS technical_specifications_path VARCHAR(500);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS technical_specifications TEXT;

-- ─── Suppliers: add explicit verified_date ──────────────────────────────────
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS verified_date TIMESTAMPTZ;

-- ─── Supplier Documents: add category and notes ─────────────────────────────
-- NOTE: These columns were first added in migration_004 with different types.
-- IF NOT EXISTS prevents conflicts. The CHECK constraint will only be applied
-- if the column is actually created here.
ALTER TABLE supplier_documents ADD COLUMN IF NOT EXISTS document_category VARCHAR(20) DEFAULT 'required'
    CHECK (document_category IN ('required','optional','supplementary'));

ALTER TABLE supplier_documents ADD COLUMN IF NOT EXISTS verification_notes TEXT;

-- ─── Required Document Types seed data (if not already present) ─────────────
INSERT INTO required_document_types (document_type, display_name, description, sort_order, is_active)
VALUES
    ('pacra_certificate', 'PACRA Certificate of Incorporation', 'Certificate of incorporation from Patents and Companies Registration Agency', 1, true),
    ('zra_tpin', 'ZRA TPIN Certificate', 'Taxpayer Identification Number certificate from Zambia Revenue Authority', 2, true),
    ('zra_tax_clearance', 'ZRA Tax Clearance Certificate', 'Valid tax clearance certificate from ZRA', 3, true),
    ('business_license', 'Business License', 'Current business license or trading permit', 4, true),
    ('directors_id', 'Directors ID Copies', 'Copies of national ID or passport for all directors', 5, true),
    ('bank_reference', 'Bank Reference Letter', 'Bank reference letter or proof of bank account', 6, true),
    ('certificate_of_incorporation', 'Certificate of Incorporation (alternate)', 'Alternative certificate of incorporation if PACRA not available', 7, false),
    ('audited_accounts', 'Audited Financial Statements', 'Last 2 years audited financial statements', 8, false),
    ('insurance_certificate', 'Insurance Certificate', 'Professional indemnity or liability insurance', 9, false),
    ('nppa_registration', 'NPPA Registration', 'National Public Procurement Authority registration', 10, false),
    ('company_profile', 'Company Profile', 'Company profile including key personnel and past projects', 11, false),
    ('procurement_history', 'Procurement History', 'History of similar procurement contracts completed', 12, false)
ON CONFLICT (document_type) DO NOTHING;
