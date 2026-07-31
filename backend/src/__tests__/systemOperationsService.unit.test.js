jest.mock('../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../config/db');
const {
  OPERATION_CATALOG,
  executeOperation,
  normalizeMigrationName,
  publicCatalog,
  summarizeChecks,
  validateOperationInput,
} = require('../services/systemOperationsService');

describe('system operations control plane', () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnvironment };
    jest.clearAllMocks();
  });

  test('publishes unique allow-listed operations with confirmation phrases for every privileged change', () => {
    const ids = OPERATION_CATALOG.map(operation => operation.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(OPERATION_CATALOG.filter(operation => operation.risk === 'critical'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'run_migrations', confirmation: 'APPLY UPGRADES' }),
        expect.objectContaining({ id: 'trigger_deploy', confirmation: 'DEPLOY LATEST' }),
      ]));
  });

  test('removes migration file extensions before comparing database state', () => {
    expect(normalizeMigrationName('1672531200004_monetization_engine.js'))
      .toBe('1672531200004_monetization_engine');
  });

  test('disables deployment until Render credentials and a service ID are configured', () => {
    delete process.env.RENDER_API_KEY;
    delete process.env.RENDER_BACKEND_SERVICE_ID;
    delete process.env.RENDER_FRONTEND_SERVICE_ID;
    expect(publicCatalog().find(operation => operation.id === 'trigger_deploy'))
      .toEqual(expect.objectContaining({ enabled: false }));
  });

  test('rejects coerced or unknown deployment options', () => {
    const operation = OPERATION_CATALOG.find(item => item.id === 'trigger_deploy');
    expect(() => validateOperationInput(operation, {
      confirmation: 'DEPLOY LATEST',
      args: { target: 'all', clearCache: 'yes' },
    })).toThrow('clearCache must be a boolean');
    expect(() => validateOperationInput(operation, {
      confirmation: 'DEPLOY LATEST',
      args: { shell: 'npm install' },
    })).toThrow('Unknown deployment option');
  });

  test('rejects an incorrect confirmation before touching the database', async () => {
    await expect(executeOperation('run_migrations', {
      actor: { id: '00000000-0000-0000-0000-000000000001' },
      confirmation: 'yes',
    })).rejects.toMatchObject({ status: 400 });
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('summarizes warnings without hiding failures', () => {
    expect(summarizeChecks([
      { status: 'passed' },
      { status: 'warning' },
    ], 'Checks passed')).toEqual(expect.objectContaining({ status: 'warning' }));
    expect(summarizeChecks([
      { status: 'warning' },
      { status: 'failed' },
    ], 'Checks passed')).toEqual(expect.objectContaining({ status: 'failed', summary: '1 check failed' }));
  });
});
