/**
 * Migration: Create procurement_requests table
 * Allows customers to submit procurement/order requests directly to Business Admin.
 */
exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS procurement_requests (
      id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                UUID         NOT NULL REFERENCES tenants(id),
      customer_user_id         UUID         NOT NULL REFERENCES tenant_users(id),
      title                    VARCHAR(255) NOT NULL,
      description              TEXT,
      estimated_budget         NUMERIC(15,2),
      payment_method           VARCHAR(50),
      required_delivery_date   TIMESTAMPTZ,
      status                   VARCHAR(25)  NOT NULL DEFAULT 'pending'
                                            CHECK (status IN ('pending', 'approved', 'converted_to_bid', 'rejected')),
      admin_notes              TEXT,
      created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS procurement_requests_tenant_idx ON procurement_requests(tenant_id);
    CREATE INDEX IF NOT EXISTS procurement_requests_status_idx ON procurement_requests(status);
  `);
};

exports.down = pgm => {
  pgm.sql(`
    DROP TABLE IF EXISTS procurement_requests CASCADE;
  `);
};
