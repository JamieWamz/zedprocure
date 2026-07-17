-- ============================================================================
-- Migration 005: Open Marketplace
-- Adds columns for global visibility, business categories, immutable audit
-- logging, and in-app notifications.
-- ============================================================================

-- ─── Suppliers: add business_category and documents cache ────────────────────
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS business_category VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS documents JSONB DEFAULT '[]';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

-- ─── Bids: add visibility and business_category ─────────────────────────────
ALTER TABLE bids ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'global'
    CHECK (visibility IN ('global', 'restricted'));
ALTER TABLE bids ADD COLUMN IF NOT EXISTS business_category VARCHAR(100);

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