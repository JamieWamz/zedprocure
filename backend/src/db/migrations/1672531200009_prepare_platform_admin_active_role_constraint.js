/**
 * Prepare enforcement of the platform's single-active-seat rule. Existing
 * deployments may contain legacy conflicts that must be repaired through the
 * maintenance UI, so this migration warns and defers the index instead of
 * blocking that UI from being deployed.
 */
exports.up = pgm => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT role
        FROM platform_admins
        WHERE is_active = TRUE
        GROUP BY role
        HAVING COUNT(*) > 1
      ) THEN
        RAISE WARNING
          'Active administrator role index deferred: resolve multiple active accounts through system maintenance';
      ELSE
        EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS platform_admins_one_active_role_idx
          ON platform_admins(role) WHERE is_active = TRUE';
      END IF;
    END $$;
  `);
};

exports.down = pgm => {
  pgm.sql(`
    DROP INDEX IF EXISTS platform_admins_one_active_role_idx;
  `);
};
