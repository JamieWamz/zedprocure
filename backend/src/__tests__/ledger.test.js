const pool = require('../config/db');
const { createJournalEntry, LEDGER_ACCOUNTS } = require('../services/ledgerService');

describe('Ledger Service', () => {
  let client;

  beforeAll(async () => {
    // It's crucial to use a separate test database
    // This setup assumes DATABASE_URL is configured for a test DB
    client = await pool.connect();
    // Clean up tables before tests
    await client.query('TRUNCATE TABLE journal_lines, journal_entries, accounts RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await client.release();
    await pool.end();
  });

  describe('createJournalEntry', () => {
    beforeEach(async () => {
      // Clean up tables before each test
      await client.query('TRUNCATE TABLE journal_lines, journal_entries, accounts RESTART IDENTITY CASCADE');
      // Seed accounts
      await client.query(`
        INSERT INTO accounts (account_code, account_name, account_type) VALUES
        ('CASH_BANK', 'Cash and Bank', 'asset'),
        ('PLATFORM_REVENUE', 'Platform Revenue', 'revenue');
      `);
    });

    it('should create a balanced journal entry', async () => {
      const entryData = {
        referenceType: 'test_ref',
        referenceId: 'test_id_123',
        description: 'Test transaction',
        createdBy: 'test_user',
        lines: [
          { accountCode: 'CASH_BANK', debit: 100, credit: 0 },
          { accountCode: 'PLATFORM_REVENUE', debit: 0, credit: 100 },
        ],
      };

      const entryId = await createJournalEntry(entryData, client);

      expect(entryId).toBeDefined();

      const { rows: entryRows } = await client.query('SELECT * FROM journal_entries WHERE id = $1', [entryId]);
      expect(entryRows).toHaveLength(1);
      expect(entryRows[0].description).toBe('Test transaction');

      const { rows: lineRows } = await client.query('SELECT * FROM journal_lines WHERE journal_entry_id = $1 ORDER BY debit DESC', [entryId]);
      expect(lineRows).toHaveLength(2);
      expect(lineRows[0].debit).toBe('100.00');
      expect(lineRows[0].credit).toBe('0.00');
      expect(lineRows[1].debit).toBe('0.00');
      expect(lineRows[1].credit).toBe('100.00');
    });

    it('should throw an error for an unbalanced journal entry', async () => {
      const entryData = {
        referenceType: 'test_ref',
        referenceId: 'test_id_456',
        description: 'Unbalanced transaction',
        createdBy: 'test_user',
        lines: [
          { accountCode: 'CASH_BANK', debit: 100, credit: 0 },
          { accountCode: 'PLATFORM_REVENUE', debit: 0, credit: 99 }, // Unbalanced
        ],
      };

      await expect(createJournalEntry(entryData, client)).rejects.toThrow(
        'Journal entry must have equal positive debits and credits'
      );
    });

    it('should throw an error for a journal entry with zero amount', async () => {
        const entryData = {
          referenceType: 'test_ref',
          referenceId: 'test_id_789',
          description: 'Zero amount transaction',
          createdBy: 'test_user',
          lines: [
            { accountCode: 'CASH_BANK', debit: 0, credit: 0 },
            { accountCode: 'PLATFORM_REVENUE', debit: 0, credit: 0 },
          ],
        };

        await expect(createJournalEntry(entryData, client)).rejects.toThrow(
          'Journal entry must have equal positive debits and credits'
        );
      });
  });
});
