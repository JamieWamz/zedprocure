/**
 * Migration: Add UNIQUE constraint on bid_requirements (bid_id, customer_user_id)
 *
 * The customer portal allows submitting requirements per bid. Without this
 * constraint the POST endpoint would insert duplicate rows on every click.
 * We clean up any existing duplicates before adding the constraint.
 */
exports.up = pgm => {
  // Deduplicate by keeping the latest row for each (bid_id, customer_user_id) pair
  pgm.sql(`
    DELETE FROM bid_requirements
    WHERE id NOT IN (
      SELECT DISTINCT ON (bid_id, customer_user_id) id
      FROM bid_requirements
      ORDER BY bid_id, customer_user_id, created_at DESC
    );
  `);

  // Add unique constraint so the ON CONFLICT clause in the API works correctly
  pgm.sql(`
    ALTER TABLE bid_requirements
    ADD CONSTRAINT bid_requirements_bid_user_unique
    UNIQUE (bid_id, customer_user_id);
  `);
};

exports.down = pgm => {
  pgm.sql(`
    ALTER TABLE bid_requirements
    DROP CONSTRAINT IF EXISTS bid_requirements_bid_user_unique;
  `);
};
