-- ============================================================================
-- Migration 007: Supplier BoQ Response & Bid Evaluation
-- Enables per-line-item pricing by suppliers and admin evaluation/award workflow.
-- Dependencies: Requires migration_006 (bid_line_items) to have been applied first.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Supplier Response Line Items (per-line-item pricing) ───────────────────
-- supplier_responses table is created in schema.sql
-- bid_line_items table is created in migration_006_boq_bid_structure.sql
CREATE TABLE IF NOT EXISTS bid_response_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_response_id UUID NOT NULL REFERENCES supplier_responses(id) ON DELETE CASCADE,
    bid_line_item_id UUID NOT NULL REFERENCES bid_line_items(id),
    unit_price DECIMAL(15,2) NOT NULL CHECK (unit_price >= 0),
    total_price DECIMAL(15,2) NOT NULL CHECK (total_price >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resp_line_items_response ON bid_response_line_items(supplier_response_id);
CREATE INDEX IF NOT EXISTS idx_resp_line_items_boq ON bid_response_line_items(bid_line_item_id);

-- ─── Bid Evaluation Scores (for best-value evaluation) ──────────────────────
CREATE TABLE IF NOT EXISTS bid_evaluation_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    criteria_name VARCHAR(100) NOT NULL,
    score DECIMAL(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
    weight DECIMAL(5,2) NOT NULL DEFAULT 1.00 CHECK (weight >= 0 AND weight <= 100),
    comments TEXT,
    scored_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bid_id, supplier_id, criteria_name)
);

CREATE INDEX IF NOT EXISTS idx_eval_scores_bid ON bid_evaluation_scores(bid_id);

-- ─── Award Decision Log ─────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS award_decision_notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS awarded_by UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS awarded_at TIMESTAMPTZ;

-- ─── Evaluation summary view (optional convenience) ────────────────────────
CREATE OR REPLACE VIEW bid_evaluation_summary AS
SELECT
    bes.bid_id,
    bes.supplier_id,
    s.company_name AS supplier_name,
    COUNT(bes.id) AS criteria_count,
    SUM(bes.score * bes.weight) / NULLIF(SUM(bes.weight), 0) AS weighted_average_score
FROM bid_evaluation_scores bes
JOIN suppliers s ON s.id = bes.supplier_id
GROUP BY bes.bid_id, bes.supplier_id, s.company_name;
