const fs = require('fs');
const path = require('path');

// Helper to run a SQL file relative to the original db/ directory
const runSqlFile = (pgm, filePath) => {
  const fullPath = path.join(__dirname, '..', filePath); // from src/db/migrations to src/db/
  const sql = fs.readFileSync(fullPath, 'utf8');
  pgm.sql(sql);
};

exports.up = pgm => {
  console.log('Applying initial schema and legacy migrations...');
  // Run the initial schema and all existing manual migrations in order
  runSqlFile(pgm, 'schema.sql');
  runSqlFile(pgm, 'migration_002_production.sql');
  runSqlFile(pgm, 'migration_003_verification.sql');
  runSqlFile(pgm, 'migration_004_manual_verification.sql');
  runSqlFile(pgm, 'migration_005_open_marketplace.sql');
  runSqlFile(pgm, 'migration_006_boq_bid_structure.sql');
  runSqlFile(pgm, 'migration_007_response_evaluation.sql');
  console.log('All schema and legacy migrations applied.');
};

exports.down = pgm => {
  console.log('Reverting initial schema and legacy migrations...');
  // This demonstrates how to reverse the changes from migration_004.
  // For a complete rollback, you would need to add DROP statements for all tables,
  // types, and functions created in your other SQL files, in reverse order of creation.
  
  pgm.sql('DROP VIEW IF EXISTS bid_evaluation_summary CASCADE;');
  pgm.sql('DROP TABLE IF EXISTS bid_evaluation_scores CASCADE;');
  pgm.sql('DROP TABLE IF EXISTS bid_response_line_items CASCADE;');
  pgm.sql('DROP TABLE IF EXISTS bid_line_items CASCADE;');
  pgm.sql('DROP TABLE IF EXISTS required_document_types CASCADE;');
  pgm.sql('ALTER TABLE supplier_documents DROP COLUMN IF EXISTS document_category;');
  pgm.sql('ALTER TABLE supplier_documents DROP COLUMN IF EXISTS verification_notes;');
  pgm.sql('ALTER TABLE suppliers DROP COLUMN IF EXISTS verification_notes;');
  pgm.sql('ALTER TABLE suppliers DROP COLUMN IF EXISTS verification_method;');

  console.log('Down migration for initial schema is a placeholder. Please implement fully if rollbacks are needed.');
};
