/**
 * Repair supplier-registration schema for databases that recorded the original
 * aggregate migration before the legacy verification/marketplace SQL was added.
 * Every operation is additive or idempotent so fully migrated databases are
 * unchanged while older deployments receive the final registration schema.
 */
exports.up = pgm => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    CREATE TABLE IF NOT EXISTS business_categories (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(100) UNIQUE NOT NULL,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS business_categories_name_unique_idx
      ON business_categories(name);

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

    ALTER TABLE suppliers
      ADD COLUMN IF NOT EXISTS business_category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS verification_method VARCHAR(20) DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS verification_notes TEXT,
      ADD COLUMN IF NOT EXISTS verified_date TIMESTAMPTZ;

    DO $$
    DECLARE existing_constraint RECORD;
    BEGIN
      FOR existing_constraint IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'suppliers'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%verification_method%'
      LOOP
        EXECUTE format('ALTER TABLE suppliers DROP CONSTRAINT %I', existing_constraint.conname);
      END LOOP;
    END $$;

    UPDATE suppliers
      SET verification_method = 'manual'
      WHERE verification_method IS NULL
         OR verification_method NOT IN ('manual', 'automated');

    ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_verification_method_registration_check
      CHECK (verification_method IN ('manual', 'automated'));

    UPDATE suppliers
      SET business_category = NULLIF(TRIM(business_category), '')
      WHERE business_category IS NOT NULL;

    INSERT INTO business_categories (name)
      SELECT DISTINCT business_category
      FROM suppliers
      WHERE business_category IS NOT NULL
    ON CONFLICT (name) DO NOTHING;

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'suppliers'
          AND constraint_name = 'fk_suppliers_business_category'
      ) THEN
        ALTER TABLE suppliers
          ADD CONSTRAINT fk_suppliers_business_category
          FOREIGN KEY (business_category) REFERENCES business_categories(name)
          ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;
    END $$;

    ALTER TABLE supplier_documents
      ADD COLUMN IF NOT EXISTS document_category VARCHAR(50) DEFAULT 'optional',
      ADD COLUMN IF NOT EXISTS verification_notes TEXT;

    DO $$
    DECLARE existing_constraint RECORD;
    BEGIN
      FOR existing_constraint IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'supplier_documents'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%document_category%'
      LOOP
        EXECUTE format('ALTER TABLE supplier_documents DROP CONSTRAINT %I', existing_constraint.conname);
      END LOOP;
    END $$;

    UPDATE supplier_documents
      SET document_category = 'optional'
      WHERE document_category IS NULL
         OR document_category NOT IN ('required', 'optional', 'supplementary');

    ALTER TABLE supplier_documents
      ADD CONSTRAINT supplier_documents_document_category_check
      CHECK (document_category IN ('required', 'optional', 'supplementary'));

    CREATE TABLE IF NOT EXISTS required_document_types (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      document_type VARCHAR(50) NOT NULL UNIQUE,
      display_name VARCHAR(100) NOT NULL,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    ALTER TABLE required_document_types
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

    CREATE UNIQUE INDEX IF NOT EXISTS required_document_types_document_type_unique_idx
      ON required_document_types(document_type);

    INSERT INTO required_document_types
      (document_type, display_name, description, sort_order, is_active)
    VALUES
      ('pacra_certificate', 'PACRA Certificate of Incorporation', 'Certificate of incorporation from Patents and Companies Registration Agency', 1, TRUE),
      ('zra_tpin', 'ZRA TPIN Certificate', 'Taxpayer Identification Number certificate from Zambia Revenue Authority', 2, TRUE),
      ('zra_tax_clearance', 'ZRA Tax Clearance Certificate', 'Valid tax clearance certificate from ZRA', 3, TRUE),
      ('business_license', 'Business License', 'Current business license or trading permit', 4, TRUE),
      ('directors_id', 'Directors ID Copies', 'Copies of national ID or passport for all directors', 5, TRUE),
      ('bank_reference', 'Bank Reference Letter', 'Bank reference letter or proof of bank account', 6, TRUE),
      ('certificate_of_incorporation', 'Certificate of Incorporation (alternate)', 'Alternative certificate of incorporation if PACRA is unavailable', 7, FALSE),
      ('audited_accounts', 'Audited Financial Statements', 'Last two years of audited financial statements', 8, FALSE),
      ('insurance_certificate', 'Insurance Certificate', 'Professional indemnity or liability insurance', 9, FALSE),
      ('nppa_registration', 'NPPA Registration', 'National Public Procurement Authority registration', 10, FALSE),
      ('company_profile', 'Company Profile', 'Company profile including key personnel and past projects', 11, FALSE),
      ('procurement_history', 'Procurement History', 'History of similar procurement contracts completed', 12, FALSE)
    ON CONFLICT (document_type) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

    CREATE INDEX IF NOT EXISTS idx_supplier_documents_category
      ON supplier_documents(supplier_id, document_category);
    CREATE INDEX IF NOT EXISTS idx_required_document_types_active
      ON required_document_types(is_active, sort_order);
    CREATE INDEX IF NOT EXISTS idx_suppliers_business_category
      ON suppliers(business_category) WHERE business_category IS NOT NULL;
  `);
};

// This is a repair migration. Reversing it could remove columns or lookup data
// that pre-dated the repair, so rollback intentionally preserves the schema.
exports.down = () => {};
