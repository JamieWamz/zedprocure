-- ============================================================================
-- Migration 005: Open Marketplace
-- Adds columns for global visibility and business categories to enable an
-- open marketplace where suppliers can find relevant bids.
-- This also normalizes business categories into a dedicated table.
-- ============================================================================

-- ─── Business Categories: create and seed a central table ───────────────────
CREATE TABLE IF NOT EXISTS business_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true
);

-- Seed the categories from the hardcoded list in the frontend
INSERT INTO business_categories (name) VALUES
    ('Construction & Infrastructure'),
    ('ICT & Software'),
    ('Healthcare & Medical'),
    ('Agriculture & Food'),
    ('Transport & Logistics'),
    ('Education & Training'),
    ('Professional Services'),
    ('Manufacturing'),
    ('Energy & Utilities'),
    ('Other')
ON CONFLICT (name) DO NOTHING;

-- ─── Suppliers: add business_category foreign key ───────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='business_category') THEN
        ALTER TABLE suppliers ADD COLUMN business_category VARCHAR(100);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'suppliers' AND constraint_name = 'fk_suppliers_business_category'
    ) THEN
        ALTER TABLE suppliers ADD CONSTRAINT fk_suppliers_business_category
        FOREIGN KEY (business_category) REFERENCES business_categories(name) ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;

-- ─── Bids: add visibility and business_category foreign key ─────────────────
ALTER TABLE bids ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'global'
    CHECK (visibility IN ('global', 'restricted'));

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bids' AND column_name='business_category') THEN
        ALTER TABLE bids ADD COLUMN business_category VARCHAR(100);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'bids' AND constraint_name = 'fk_bids_business_category'
    ) THEN
        ALTER TABLE bids ADD CONSTRAINT fk_bids_business_category
        FOREIGN KEY (business_category) REFERENCES business_categories(name) ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;

-- ─── Indexes for performance ────────────────────────────────────────────────
-- Index for finding suppliers by their business category
CREATE INDEX IF NOT EXISTS idx_suppliers_business_category ON suppliers(business_category) WHERE business_category IS NOT NULL;
-- Index for finding open, global bids in the marketplace, filtered by category
CREATE INDEX IF NOT EXISTS idx_bids_visibility_category ON bids(visibility, business_category) WHERE status = 'open';
-- Index on the new categories table
CREATE INDEX IF NOT EXISTS idx_business_categories_name ON business_categories(name);
