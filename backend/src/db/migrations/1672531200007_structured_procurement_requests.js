/**
 * Preserve customer request structure through bid conversion.
 * JSONB removes the need to scrape user-facing prose, while the foreign keys
 * keep the original request and generated bid traceable in both directions.
 */
exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE procurement_requests
      ADD COLUMN IF NOT EXISTS requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS converted_bid_id UUID REFERENCES bids(id) ON DELETE SET NULL;

    ALTER TABLE bids
      ADD COLUMN IF NOT EXISTS source_request_id UUID REFERENCES procurement_requests(id) ON DELETE SET NULL;

    ALTER TABLE bid_requirements
      ALTER COLUMN expected_delivery_time TYPE VARCHAR(120)
      USING expected_delivery_time::text;

    CREATE UNIQUE INDEX IF NOT EXISTS bids_source_request_unique_idx
      ON bids(source_request_id) WHERE source_request_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS procurement_requests_converted_bid_idx
      ON procurement_requests(converted_bid_id) WHERE converted_bid_id IS NOT NULL;
  `);
};

exports.down = pgm => {
  pgm.sql(`
    DROP INDEX IF EXISTS procurement_requests_converted_bid_idx;
    DROP INDEX IF EXISTS bids_source_request_unique_idx;
    ALTER TABLE bids DROP COLUMN IF EXISTS source_request_id;
    ALTER TABLE procurement_requests
      DROP COLUMN IF EXISTS converted_bid_id,
      DROP COLUMN IF EXISTS requirements;
  `);
};
