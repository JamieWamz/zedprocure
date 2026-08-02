const migration = require('../db/migrations/1672531200009_prepare_platform_admin_active_role_constraint');

describe('identity constraints migration', () => {
  test('creates the active-seat index only when historical seat data is clean', () => {
    const pgm = { sql: jest.fn() };

    migration.up(pgm);

    expect(pgm.sql).toHaveBeenCalledTimes(1);
    const sql = pgm.sql.mock.calls[0][0];
    expect(sql).toContain('HAVING COUNT(*) > 1');
    expect(sql).toContain('RAISE WARNING');
    expect(sql).toContain('index deferred');
    expect(sql).toContain('platform_admins_one_active_role_idx');
    expect(sql).toContain('WHERE is_active = TRUE');
    expect(sql).not.toContain('LOWER(BTRIM(email))');
    expect(sql).not.toContain('RAISE EXCEPTION');
    expect(sql).not.toMatch(/UPDATE (platform_admins|tenant_users|supplier_users)/);
  });

  test('drops only the indexes introduced by the migration', () => {
    const pgm = { sql: jest.fn() };

    migration.down(pgm);

    const sql = pgm.sql.mock.calls[0][0];
    expect(sql.match(/DROP INDEX IF EXISTS/g)).toHaveLength(1);
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|UPDATE /);
  });
});
