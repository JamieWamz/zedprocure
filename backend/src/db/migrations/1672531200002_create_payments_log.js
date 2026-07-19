/**
 * Migration: Create payments_log table
 *
 * Stores a record for every payment initiated through ZedProcure,
 * regardless of provider (MTN, Airtel, Zamtel, Bank).
 *
 * This is separate from the existing payment_transactions table (which handles
 * bidding fees via the wallet system) so that neither table breaks the other.
 */
exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS payments_log (
      id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id                  UUID         REFERENCES orders(id) ON DELETE CASCADE,
      provider                  VARCHAR(20)  NOT NULL CHECK (provider IN ('mtn','airtel','zamtel','bank')),
      provider_reference        VARCHAR(255),
      provider_callback_payload JSONB,
      amount                    NUMERIC(15,2) NOT NULL CHECK (amount > 0),
      status                    VARCHAR(20)  NOT NULL DEFAULT 'pending'
                                             CHECK (status IN ('pending','successful','failed','refunded')),
      initiated_by              UUID,
      created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now()
    );

    -- Index for fast webhook lookups by provider + reference
    CREATE UNIQUE INDEX IF NOT EXISTS payments_log_provider_ref_idx
      ON payments_log (provider, provider_reference)
      WHERE provider_reference IS NOT NULL;

    -- Index for the /api/payments/order/:orderId route
    CREATE INDEX IF NOT EXISTS payments_log_order_id_idx
      ON payments_log (order_id);
  `);
};

exports.down = pgm => {
  pgm.sql(`
    DROP TABLE IF EXISTS payments_log CASCADE;
  `);
};
