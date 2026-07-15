/**
 * Invoicing (AR / AP) — create invoices, record payments, track status and
 * ageing, and surface role-scoped views so suppliers and customers can track
 * the invoices that involve them.
 *
 * All money movements post to the immutable general ledger via ledgerService.
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const { recordInvoiceIssue, recordInvoicePayment } = require('../services/ledgerService');
const { sendMail } = require('../services/emailService');

const router = express.Router();

const OPEN_STATUSES = ['sent', 'partially_paid'];

// Resolve which invoices a given user may see / edit.
async function resolvePartyScope(client, user) {
  if (user.user_type === 'platform_admin') return null; // unrestricted
  if (user.user_type === 'supplier_user') {
    const { rows } = await client.query('SELECT supplier_id, email FROM supplier_users WHERE id = $1', [user.user_id]);
    return rows[0]
      ? { party_type: 'supplier', party_id: rows[0].supplier_id, email: rows[0].email || user.email }
      : { party_type: 'supplier', party_id: null, email: user.email };
  }
  if (user.user_type === 'tenant_user') {
    return { party_type: 'customer', party_id: user.user_id, email: user.email };
  }
  return { party_type: 'external', party_id: null, email: user.email };
}

function isAdmin(user) {
  return user.user_type === 'platform_admin' && ['business_admin', 'system_admin'].includes(user.role);
}

function applyScope(where, params, index, scope) {
  if (!scope) return index;
  where.push(`party_type = $${index++}`);
  params.push(scope.party_type);

  const visibility = [];
  if (scope.party_id) {
    visibility.push(`party_id = $${index++}`);
    params.push(scope.party_id);
  }
  if (scope.email) {
    visibility.push(`LOWER(party_email) = LOWER($${index++})`);
    params.push(scope.email);
  }

  if (visibility.length) where.push(`(${visibility.join(' OR ')})`);
  else where.push('1 = 0');
  return index;
}

function canViewInvoice(scope, invoice) {
  if (!scope) return true;
  if (scope.party_type !== invoice.party_type) return false;
  if (scope.party_id && invoice.party_id === scope.party_id) return true;
  return Boolean(scope.email && invoice.party_email && scope.email.toLowerCase() === invoice.party_email.toLowerCase());
}

async function nextInvoiceNo(client, type) {
  const year = new Date().getFullYear();
  const { rows } = await client.query(
    'SELECT COUNT(*) AS c FROM invoices WHERE type = $1 AND EXTRACT(YEAR FROM created_at) = $2',
    [type, year]
  );
  const seq = String(parseInt(rows[0].c, 10) + 1).padStart(4, '0');
  return `INV-${type}-${year}-${seq}`;
}

// ─── List invoices (role-scoped, with filters) ───────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { type, status, party, due } = req.query;
    const client = await pool.connect();
    try {
      const scope = await resolvePartyScope(client, req.user);
      const where = [];
      const params = [];
      let i = 1;
      i = applyScope(where, params, i, scope);
      if (type) { where.push(`type = $${i++}`); params.push(type); }
      if (status) { where.push(`status = $${i++}`); params.push(status); }
      if (due === 'overdue') where.push(`due_date < CURRENT_DATE AND status IN ('sent','partially_paid')`);
      if (due === 'next_7') where.push(`due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' AND status IN ('sent','partially_paid')`);
      if (party) { where.push(`(party_name ILIKE $${i} OR invoice_no ILIKE $${i})`); params.push(`%${party}%`); i++; }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows } = await client.query(
        `SELECT i.*,
                CASE WHEN i.due_date < CURRENT_DATE AND i.status IN ('sent','partially_paid')
                     THEN true ELSE false END AS overdue
         FROM invoices i ${whereSql}
         ORDER BY i.created_at DESC LIMIT 500`,
        params
      );
      res.json(rows);
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('List invoices error:', e);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// ─── Summary metrics for admin, customer, and supplier invoice workspaces ────
router.get('/summary', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    const scope = await resolvePartyScope(client, req.user);
    const where = [];
    const params = [];
    let i = applyScope(where, params, 1, scope);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: [totals] } = await client.query(
      `SELECT
          COALESCE(SUM(total_amount) FILTER (WHERE type='AR'), 0) AS ar_total,
          COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE type='AR' AND status IN ('sent','partially_paid')), 0) AS ar_open,
          COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE type='AR' AND due_date < CURRENT_DATE AND status IN ('sent','partially_paid')), 0) AS ar_overdue,
          COALESCE(SUM(total_amount) FILTER (WHERE type='AP'), 0) AS ap_total,
          COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE type='AP' AND status IN ('sent','partially_paid')), 0) AS ap_open,
          COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE type='AP' AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' AND status IN ('sent','partially_paid')), 0) AS ap_due_soon,
          COALESCE(SUM(paid_amount) FILTER (WHERE updated_at >= date_trunc('month', CURRENT_DATE)), 0) AS paid_this_month,
          COUNT(*) FILTER (WHERE status='draft') AS draft_count,
          COUNT(*) FILTER (WHERE status IN ('sent','partially_paid')) AS open_count,
          COUNT(*) FILTER (WHERE status='paid') AS paid_count,
          COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status IN ('sent','partially_paid')) AS overdue_count
       FROM invoices
       ${whereSql}`,
      params
    );

    const { rows: dueRows } = await client.query(
      `SELECT id, invoice_no, type, party_name, due_date, total_amount, paid_amount,
              (total_amount - paid_amount) AS balance,
              CASE WHEN due_date < CURRENT_DATE THEN true ELSE false END AS overdue
       FROM invoices
       ${whereSql}
       ${whereSql ? 'AND' : 'WHERE'} status IN ('sent','partially_paid')
       ORDER BY due_date ASC
       LIMIT 8`,
      params
    );

    const money = (value) => parseFloat(value || 0).toFixed(2);
    res.json({
      ar: {
        total: money(totals.ar_total),
        open: money(totals.ar_open),
        overdue: money(totals.ar_overdue),
      },
      ap: {
        total: money(totals.ap_total),
        open: money(totals.ap_open),
        dueSoon: money(totals.ap_due_soon),
      },
      paidThisMonth: money(totals.paid_this_month),
      counts: {
        draft: parseInt(totals.draft_count || 0, 10),
        open: parseInt(totals.open_count || 0, 10),
        paid: parseInt(totals.paid_count || 0, 10),
        overdue: parseInt(totals.overdue_count || 0, 10),
      },
      nextDue: dueRows.map(row => ({
        ...row,
        total_amount: money(row.total_amount),
        paid_amount: money(row.paid_amount),
        balance: money(row.balance),
      })),
    });
  } catch (e) {
    console.error('Invoice summary error:', e);
    res.status(500).json({ error: 'Failed to compute invoice summary' });
  } finally {
    client.release();
  }
});

// ─── Ageing report (AR + AP buckets) ─────────────────────────────────────────
router.get('/aging', authenticate, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows } = await pool.query(
      `SELECT type,
              SUM(CASE WHEN due_date >= CURRENT_DATE THEN balance ELSE 0 END) AS current_due,
              SUM(CASE WHEN due_date < CURRENT_DATE AND due_date >= CURRENT_DATE - INTERVAL '30 days' THEN balance ELSE 0 END) AS d0_30,
              SUM(CASE WHEN due_date < CURRENT_DATE - INTERVAL '30 days' AND due_date >= CURRENT_DATE - INTERVAL '60 days' THEN balance ELSE 0 END) AS d31_60,
              SUM(CASE WHEN due_date < CURRENT_DATE - INTERVAL '60 days' AND due_date >= CURRENT_DATE - INTERVAL '90 days' THEN balance ELSE 0 END) AS d61_90,
              SUM(CASE WHEN due_date < CURRENT_DATE - INTERVAL '90 days' THEN balance ELSE 0 END) AS d90_plus,
              SUM(balance) AS total
       FROM (
         SELECT type, due_date, (total_amount - paid_amount) AS balance
         FROM invoices
         WHERE status IN ('sent','partially_paid')
       ) open_inv
       GROUP BY type`
    );
    const byType = {};
    for (const r of rows) {
      byType[r.type] = {
        current: parseFloat(r.current_due).toFixed(2),
        d0_30: parseFloat(r.d0_30).toFixed(2),
        d31_60: parseFloat(r.d31_60).toFixed(2),
        d61_90: parseFloat(r.d61_90).toFixed(2),
        d90_plus: parseFloat(r.d90_plus).toFixed(2),
        total: parseFloat(r.total).toFixed(2),
      };
    }
    res.json({ ar: byType.AR || zeroBuckets(), ap: byType.AP || zeroBuckets() });
  } catch (e) {
    console.error('Aging error:', e);
    res.status(500).json({ error: 'Failed to compute ageing' });
  }
});

function zeroBuckets() {
  return { current: '0.00', d0_30: '0.00', d31_60: '0.00', d61_90: '0.00', d90_plus: '0.00', total: '0.00' };
}

// ─── Parties for fast invoice creation ──────────────────────────────────────
router.get('/parties', authenticate, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
  const { type } = req.query;
  try {
    const [customers, suppliers] = await Promise.all([
      !type || type === 'customer'
        ? pool.query(
          `SELECT tu.id AS party_id, 'customer' AS party_type, tu.full_name AS name, tu.email,
                  t.name AS organization
           FROM tenant_users tu
           JOIN tenants t ON t.id = tu.tenant_id
           WHERE tu.is_active = true
           ORDER BY t.name, tu.full_name
           LIMIT 250`
        )
        : Promise.resolve({ rows: [] }),
      !type || type === 'supplier'
        ? pool.query(
          `SELECT s.id AS party_id, 'supplier' AS party_type, s.company_name AS name,
                  su.email, s.registration_number AS organization
           FROM suppliers s
           LEFT JOIN LATERAL (
             SELECT email FROM supplier_users su WHERE su.supplier_id = s.id AND su.is_active = true ORDER BY su.email LIMIT 1
           ) su ON true
           WHERE s.is_active = true
           ORDER BY s.company_name
           LIMIT 250`
        )
        : Promise.resolve({ rows: [] }),
    ]);

    res.json([...customers.rows, ...suppliers.rows]);
  } catch (e) {
    console.error('Invoice parties error:', e);
    res.status(500).json({ error: 'Failed to fetch invoice parties' });
  }
});

// ─── Create invoice ──────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
  const {
    type, party_type, party_id, party_name, party_email,
    order_id, bid_id, issue_date, due_date, currency, notes, lines,
    status: requestedStatus,
  } = req.body;

  if (!type || !['AR', 'AP'].includes(type)) return res.status(400).json({ error: 'type must be AR or AP' });
  if (!party_name) return res.status(400).json({ error: 'party_name is required' });
  if (!due_date) return res.status(400).json({ error: 'due_date is required' });
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'At least one line item is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let subtotal = 0, taxAmount = 0;
    const cleanLines = lines.map((l, idx) => {
      const qty = parseFloat(l.quantity ?? 1) || 0;
      const price = parseFloat(l.unit_price ?? 0) || 0;
      const tax = parseFloat(l.tax_rate ?? 0) || 0;
      const net = qty * price;
      const amt = net + (net * tax) / 100;
      subtotal += net;
      taxAmount += amt - net;
      return { description: l.description, quantity: qty, unit_price: price, tax_rate: tax, amount: amt, line_order: idx };
    });
    const total = subtotal + taxAmount;
    const status = requestedStatus === 'sent' ? 'sent' : 'draft';
    const invoiceNo = await nextInvoiceNo(client, type);
    const safeIssueDate = issue_date || new Date().toISOString().slice(0, 10);

    const { rows: [inv] } = await client.query(
      `INSERT INTO invoices
        (invoice_no, type, party_type, party_id, party_name, party_email, order_id, bid_id,
         issue_date, due_date, status, subtotal, tax_amount, total_amount, currency, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [invoiceNo, type, party_type || 'external', party_id || null, party_name, party_email || null,
       order_id || null, bid_id || null, safeIssueDate, due_date, status,
       subtotal.toFixed(2), taxAmount.toFixed(2), total.toFixed(2), currency || 'ZMW', notes || null, req.user.user_id]
    );

    for (const l of cleanLines) {
      await client.query(
        `INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_price, tax_rate, amount, line_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [uuidv4(), inv.id, l.description, l.quantity, l.unit_price, l.tax_rate, l.amount.toFixed(2), l.line_order]
      );
    }

    // Post the recognition entry when issued immediately.
    if (status === 'sent') {
      await recordInvoiceIssue(inv, req.user.user_id, client);
      if (inv.party_email) {
        await sendMail({
          to: inv.party_email,
          subject: `Invoice ${inv.invoice_no} from Zambia Procurement Portal`,
          html: `<p>Dear ${inv.party_name},</p><p>Invoice <b>${inv.invoice_no}</b> for ZMW ${parseFloat(inv.total_amount).toFixed(2)} has been issued. Due date: ${inv.due_date}.</p>`,
        }).catch(() => {});
      }
    }

    await client.query('COMMIT');
    res.status(201).json(inv);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Create invoice error:', e);
    res.status(500).json({ error: 'Failed to create invoice: ' + e.message });
  } finally {
    client.release();
  }
});

// ─── Get single invoice (with lines + payments) ──────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const scope = await resolvePartyScope(client, req.user);
      const { rows: [inv] } = await client.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
      if (!inv) return res.status(404).json({ error: 'Invoice not found' });
      if (!canViewInvoice(scope, inv)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const { rows: lines } = await client.query('SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY line_order', [inv.id]);
      const { rows: payments } = await client.query('SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY payment_date', [inv.id]);
      res.json({ ...inv, lines, payments });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Get invoice error:', e);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// ─── Update status (issue / cancel) ──────────────────────────────────────────
router.patch('/:id', authenticate, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
  const { status } = req.body;
  if (!['sent', 'cancelled', 'draft'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [inv] } = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!inv) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Invoice not found' }); }

    if (status === 'sent' && inv.status !== 'sent') {
      // Post recognition entry once (guard against duplicates).
      const { rows: [existing] } = await client.query(
        "SELECT 1 FROM journal_entries WHERE reference_type='invoice_issue' AND reference_id=$1", [inv.id]
      );
      if (!existing) await recordInvoiceIssue(inv, req.user.user_id, client);
      if (inv.party_email) {
        await sendMail({
          to: inv.party_email,
          subject: `Invoice ${inv.invoice_no} from Zambia Procurement Portal`,
          html: `<p>Dear ${inv.party_name},</p><p>Invoice <b>${inv.invoice_no}</b> for ${inv.currency || 'ZMW'} ${parseFloat(inv.total_amount).toFixed(2)} has been issued. Due date: ${inv.due_date}.</p>`,
        }).catch(() => {});
      }
    }
    const { rows: [updated] } = await client.query(
      'UPDATE invoices SET status=$1, updated_at=now() WHERE id=$2 RETURNING *', [status, inv.id]
    );
    await client.query('COMMIT');
    res.json(updated);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Update invoice error:', e);
    res.status(500).json({ error: 'Failed to update invoice' });
  } finally {
    client.release();
  }
});

// ─── Send an invoice payment reminder ───────────────────────────────────────
router.post('/:id/reminders', authenticate, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows: [inv] } = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (!inv.party_email) return res.status(400).json({ error: 'Invoice has no party email' });
    if (!OPEN_STATUSES.includes(inv.status)) return res.status(400).json({ error: 'Only open invoices can receive reminders' });

    const balance = parseFloat(inv.total_amount) - parseFloat(inv.paid_amount);
    await sendMail({
      to: inv.party_email,
      subject: `Payment reminder — Invoice ${inv.invoice_no}`,
      html: `<p>Dear ${inv.party_name},</p><p>This is a payment reminder for invoice <b>${inv.invoice_no}</b>. Outstanding balance: ${inv.currency || 'ZMW'} ${balance.toFixed(2)}. Due date: ${inv.due_date}.</p>`,
    });
    res.json({ success: true });
  } catch (e) {
    console.error('Invoice reminder error:', e);
    res.status(500).json({ error: 'Failed to send reminder' });
  }
});

// ─── Record a payment ────────────────────────────────────────────────────────
router.post('/:id/payments', authenticate, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
  const { amount, payment_date, method, reference } = req.body;
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'A positive amount is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [inv] } = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!inv) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Invoice not found' }); }
    if (inv.status === 'cancelled' || inv.status === 'paid') {
      await client.query('ROLLBACK'); return res.status(400).json({ error: `Invoice is ${inv.status}` });
    }
    const remaining = parseFloat(inv.total_amount) - parseFloat(inv.paid_amount);
    if (amt > remaining + 0.005) {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'Payment exceeds remaining balance' });
    }

    const { rows: [pay] } = await client.query(
      `INSERT INTO invoice_payments (id, invoice_id, amount, payment_date, method, reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [uuidv4(), inv.id, amt.toFixed(2), payment_date || new Date().toISOString().slice(0, 10), method || 'bank_transfer', reference || null, req.user.user_id]
    );

    const { rows: [issued] } = await client.query(
      "SELECT 1 FROM journal_entries WHERE reference_type='invoice_issue' AND reference_id=$1",
      [inv.id]
    );
    if (!issued) await recordInvoiceIssue(inv, req.user.user_id, client);

    const newPaid = parseFloat(inv.paid_amount) + amt;
    const newStatus = newPaid >= parseFloat(inv.total_amount) - 0.005 ? 'paid' : 'partially_paid';
    const { rows: [updated] } = await client.query(
      'UPDATE invoices SET paid_amount=$1, status=$2, updated_at=now() WHERE id=$3 RETURNING *',
      [newPaid.toFixed(2), newStatus, inv.id]
    );

    await recordInvoicePayment(inv, amt, req.user.user_id, client);

    if (inv.party_email) {
      await sendMail({
        to: inv.party_email,
        subject: `Payment received — Invoice ${inv.invoice_no}`,
        html: `<p>Dear ${inv.party_name},</p><p>We received ZMW ${amt.toFixed(2)} for invoice <b>${inv.invoice_no}</b>. Remaining balance: ZMW ${(parseFloat(updated.total_amount) - newPaid).toFixed(2)}.</p>`,
      }).catch(() => {});
    }

    await client.query('COMMIT');
    res.status(201).json({ payment: pay, invoice: updated });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Record payment error:', e);
    res.status(500).json({ error: 'Failed to record payment' });
  } finally {
    client.release();
  }
});

module.exports = router;
