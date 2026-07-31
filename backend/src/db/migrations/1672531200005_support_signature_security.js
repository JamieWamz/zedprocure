exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS support_issues (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      reference VARCHAR(24) UNIQUE NOT NULL,
      reporter_user_id UUID NOT NULL,
      reporter_user_type VARCHAR(32) NOT NULL,
      reporter_email VARCHAR(255) NOT NULL,
      reporter_name VARCHAR(150),
      tenant_id UUID REFERENCES tenants(id),
      category VARCHAR(24) NOT NULL
        CHECK (category IN ('technical','account','bid','payment','security','other')),
      subject VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      priority VARCHAR(12) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low','normal','high')),
      status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','in_progress','resolved','closed')),
      assigned_admin_id UUID REFERENCES platform_admins(id),
      resolution_note TEXT,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS support_issues_status_created_idx ON support_issues(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS support_issues_reporter_idx ON support_issues(reporter_user_id, reporter_user_type, created_at DESC);

    ALTER TABLE digital_signatures
      ADD COLUMN IF NOT EXISTS signature_version SMALLINT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS document_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS password_verified_at TIMESTAMPTZ;

    CREATE OR REPLACE FUNCTION prevent_digital_signature_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'Digital signature records are immutable';
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS digital_signatures_immutable ON digital_signatures;
    CREATE TRIGGER digital_signatures_immutable
      BEFORE UPDATE OR DELETE ON digital_signatures
      FOR EACH ROW EXECUTE FUNCTION prevent_digital_signature_mutation();
  `);
};

exports.down = pgm => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS digital_signatures_immutable ON digital_signatures;
    DROP FUNCTION IF EXISTS prevent_digital_signature_mutation();
    ALTER TABLE digital_signatures
      DROP COLUMN IF EXISTS password_verified_at,
      DROP COLUMN IF EXISTS document_hash,
      DROP COLUMN IF EXISTS signature_version;
    DROP TABLE IF EXISTS support_issues;
  `);
};
