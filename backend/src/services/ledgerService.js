const pool = require('../config/db');
const LEDGER_ACCOUNTS = {
  CASH: 'CASH_BANK',
  ESCROW: 'ESCROW_CASH',
  PLATFORM_REVENUE: 'PLATFORM_REVENUE',
  CUSTOMER_FUNDING: 'CUSTOMER_FUNDING',
  SUPPLIER_PAYABLE: 'SUPPLIER_PAYABLE',
  ACCOUNTS_RECEIVABLE: 'ACCOUNTS_RECEIVABLE',
  ACCOUNTS_PAYABLE: 'ACCOUNTS_PAYABLE',
  SERVICE_REVENUE: 'SERVICE_REVENUE',
  SUPPLIER_EXPENSE: 'SUPPLIER_EXPENSE',
};

async function getAccountId(client, code) {
  const { rows } = await client.query('SELECT id FROM accounts WHERE account_code = $1', [code]);
  if (!rows.length) throw new Error(`Account ${code} not found`);
  return rows[0].id;
}

async function createJournalEntry({ referenceType, referenceId, description, createdBy, lines }, client) {
  const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  if (totalDebit <= 0 || Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new Error('Journal entry must have equal positive debits and credits');
  }

  // If a client is provided, the caller owns the transaction (used for atomic escrow/payment flows).
  const own = !client;
  if (own) client = await pool.connect();
  try {
    if (own) await client.query('BEGIN');
    const entryRes = await client.query(
      `INSERT INTO journal_entries (reference_type, reference_id, description, created_by)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [referenceType, referenceId, description, createdBy]
    );
    const entryId = entryRes.rows[0].id;
    for (const line of lines) {
      const accountId = await getAccountId(client, line.accountCode);
      await client.query(
        `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
         VALUES ($1,$2,$3,$4)`,
        [entryId, accountId, line.debit || 0, line.credit || 0]
      );
    }
    if (own) await client.query('COMMIT');
    return entryId;
  } catch (e) {
    if (own) await client.query('ROLLBACK');
    throw e;
  } finally {
    if (own) client.release();
  }
}

async function recordBiddingFee(bidId, userId, amount, paymentRef, client) {
  return createJournalEntry({
    referenceType: 'bid_fee',
    referenceId: bidId,
    description: `Bidding fee for bid ${bidId} - ref ${paymentRef}`,
    createdBy: userId,
    lines: [
      { accountCode: LEDGER_ACCOUNTS.CASH, debit: amount, credit: 0 },
      { accountCode: LEDGER_ACCOUNTS.PLATFORM_REVENUE, debit: 0, credit: amount }
    ]
  }, client);
}

async function recordEscrowFunding(orderId, userId, amount, client) {
  return createJournalEntry({
    referenceType: 'escrow_funding',
    referenceId: orderId,
    description: `Escrow funding for order ${orderId}`,
    createdBy: userId,
    lines: [
      { accountCode: LEDGER_ACCOUNTS.ESCROW, debit: amount, credit: 0 },
      { accountCode: LEDGER_ACCOUNTS.CUSTOMER_FUNDING, debit: 0, credit: amount }
    ]
  }, client);
}

async function recordEscrowRelease(orderId, adminUserId, amount, client) {
  await createJournalEntry({
    referenceType: 'escrow_release',
    referenceId: orderId,
    description: `Release escrow for order ${orderId}`,
    createdBy: adminUserId,
    lines: [
      { accountCode: LEDGER_ACCOUNTS.CUSTOMER_FUNDING, debit: amount, credit: 0 },
      { accountCode: LEDGER_ACCOUNTS.SUPPLIER_PAYABLE, debit: 0, credit: amount }
    ]
  }, client);
  await createJournalEntry({
    referenceType: 'payout',
    referenceId: orderId,
    description: `Payout from escrow to supplier for order ${orderId}`,
    createdBy: adminUserId,
    lines: [
      { accountCode: LEDGER_ACCOUNTS.SUPPLIER_PAYABLE, debit: amount, credit: 0 },
      { accountCode: LEDGER_ACCOUNTS.ESCROW, debit: 0, credit: amount }
    ]
  }, client);
}

// ─── Invoice recognition ─────────────────────────────────────────────────────
// When an AR invoice is issued we recognise a receivable (Dr AR, Cr Revenue).
// When an AP invoice is issued we recognise the cost (Dr Expense, Cr AP).
async function recordInvoiceIssue(invoice, userId, client) {
  const amount = Number(invoice.total_amount);
  if (invoice.type === 'AR') {
    return createJournalEntry({
      referenceType: 'invoice_issue',
      referenceId: invoice.id,
      description: `Invoice ${invoice.invoice_no} issued to ${invoice.party_name}`,
      createdBy: userId,
      lines: [
        { accountCode: LEDGER_ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: amount, credit: 0 },
        { accountCode: LEDGER_ACCOUNTS.SERVICE_REVENUE, debit: 0, credit: amount }
      ]
    }, client);
  }
  return createJournalEntry({
    referenceType: 'invoice_issue',
    referenceId: invoice.id,
    description: `Invoice ${invoice.invoice_no} received from ${invoice.party_name}`,
    createdBy: userId,
    lines: [
      { accountCode: LEDGER_ACCOUNTS.SUPPLIER_EXPENSE, debit: amount, credit: 0 },
      { accountCode: LEDGER_ACCOUNTS.ACCOUNTS_PAYABLE, debit: 0, credit: amount }
    ]
  }, client);
}

// ─── Invoice payment clearing ─────────────────────────────────────────────────
// AR payment: cash in (Dr Cash, Cr AR). AP payment: cash out (Dr AP, Cr Cash).
async function recordInvoicePayment(invoice, amount, userId, client) {
  const amt = Number(amount);
  if (invoice.type === 'AR') {
    return createJournalEntry({
      referenceType: 'invoice_payment',
      referenceId: invoice.id,
      description: `Payment received for invoice ${invoice.invoice_no}`,
      createdBy: userId,
      lines: [
        { accountCode: LEDGER_ACCOUNTS.CASH, debit: amt, credit: 0 },
        { accountCode: LEDGER_ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: 0, credit: amt }
      ]
    }, client);
  }
  return createJournalEntry({
    referenceType: 'invoice_payment',
    referenceId: invoice.id,
    description: `Payment made for invoice ${invoice.invoice_no}`,
    createdBy: userId,
    lines: [
      { accountCode: LEDGER_ACCOUNTS.ACCOUNTS_PAYABLE, debit: amt, credit: 0 },
      { accountCode: LEDGER_ACCOUNTS.CASH, debit: 0, credit: amt }
    ]
  }, client);
}

module.exports = {
  recordBiddingFee, recordEscrowFunding, recordEscrowRelease,
  recordInvoiceIssue, recordInvoicePayment, createJournalEntry,
};
