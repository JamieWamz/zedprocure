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
  SUBSIDY_EXPENSE: 'SUBSIDY_EXPENSE',
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

async function recordSubsidyFunding(orderId, userId, amount, client) {
  if (Number(amount) <= 0) return null;
  return createJournalEntry({
    referenceType: 'subsidy_funding',
    referenceId: orderId,
    description: `Platform subsidy reserve for order ${orderId}`,
    createdBy: userId,
    lines: [
      { accountCode: LEDGER_ACCOUNTS.ESCROW, debit: amount, credit: 0 },
      { accountCode: LEDGER_ACCOUNTS.CASH, debit: 0, credit: amount }
    ]
  }, client);
}

async function recordEscrowRelease(orderId, adminUserId, amounts, client) {
  const gross = Number(amounts.gross);
  const supplierPayout = Number(amounts.supplierPayout);
  const platformRevenue = Number(amounts.platformRevenue);
  const subsidyAmount = Number(amounts.subsidyAmount || 0);
  if (Math.abs(gross + subsidyAmount - supplierPayout - Math.max(platformRevenue, 0)) > 0.005) {
    throw new Error('Escrow release components must equal the funded gross amount');
  }
  const recognitionLines = [
    { accountCode: LEDGER_ACCOUNTS.CUSTOMER_FUNDING, debit: gross, credit: 0 },
    { accountCode: LEDGER_ACCOUNTS.SUPPLIER_PAYABLE, debit: 0, credit: supplierPayout },
  ];
  if (platformRevenue > 0) {
    recognitionLines.push({ accountCode: LEDGER_ACCOUNTS.PLATFORM_REVENUE, debit: 0, credit: platformRevenue });
  }
  if (subsidyAmount > 0) {
    recognitionLines.push({ accountCode: LEDGER_ACCOUNTS.SUBSIDY_EXPENSE, debit: subsidyAmount, credit: 0 });
  }
  await createJournalEntry({
    referenceType: 'escrow_release',
    referenceId: orderId,
    description: `Release escrow for order ${orderId}`,
    createdBy: adminUserId,
    lines: recognitionLines
  }, client);
  await createJournalEntry({
    referenceType: 'payout',
    referenceId: orderId,
    description: `Payout from escrow to supplier for order ${orderId}`,
    createdBy: adminUserId,
    lines: [
      { accountCode: LEDGER_ACCOUNTS.SUPPLIER_PAYABLE, debit: supplierPayout, credit: 0 },
      { accountCode: LEDGER_ACCOUNTS.ESCROW, debit: 0, credit: supplierPayout }
    ]
  }, client);
  if (platformRevenue > 0) {
    await createJournalEntry({
      referenceType: 'platform_fee_capture',
      referenceId: orderId,
      description: `Capture platform fees for order ${orderId}`,
      createdBy: adminUserId,
      lines: [
        { accountCode: LEDGER_ACCOUNTS.CASH, debit: platformRevenue, credit: 0 },
        { accountCode: LEDGER_ACCOUNTS.ESCROW, debit: 0, credit: platformRevenue }
      ]
    }, client);
  }
}

async function recordEscrowRefund(orderId, adminUserId, customerAmount, subsidyAmount, client) {
  await createJournalEntry({
    referenceType: 'escrow_refund',
    referenceId: orderId,
    description: `Refund customer escrow for order ${orderId}`,
    createdBy: adminUserId,
    lines: [
      { accountCode: LEDGER_ACCOUNTS.CUSTOMER_FUNDING, debit: customerAmount, credit: 0 },
      { accountCode: LEDGER_ACCOUNTS.ESCROW, debit: 0, credit: customerAmount }
    ]
  }, client);
  if (Number(subsidyAmount) > 0) {
    await createJournalEntry({
      referenceType: 'subsidy_refund',
      referenceId: orderId,
      description: `Return unused subsidy reserve for order ${orderId}`,
      createdBy: adminUserId,
      lines: [
        { accountCode: LEDGER_ACCOUNTS.CASH, debit: subsidyAmount, credit: 0 },
        { accountCode: LEDGER_ACCOUNTS.ESCROW, debit: 0, credit: subsidyAmount }
      ]
    }, client);
  }
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
  recordBiddingFee, recordEscrowFunding, recordSubsidyFunding, recordEscrowRelease, recordEscrowRefund,
  recordInvoiceIssue, recordInvoicePayment, createJournalEntry,
};
