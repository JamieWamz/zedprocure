const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const stripBudgetForSupplier = require('../middleware/priceIsolation');
const router = express.Router();

async function getSupplierIdForUser(userId) {
  const { rows: [supplierUser] } = await pool.query(
    'SELECT supplier_id FROM supplier_users WHERE id = $1',
    [userId]
  );
  return supplierUser?.supplier_id;
}

async function canAccessBid(user, bid) {
  if (user.user_type === 'platform_admin') return true;
  if (user.user_type === 'tenant_user') return user.tenant_id === bid.tenant_id;
  if (user.user_type === 'supplier_user') {
    const supplierId = await getSupplierIdForUser(user.user_id);
    if (!supplierId) return false;
    const { rowCount } = await pool.query(
      'SELECT 1 FROM bid_suppliers WHERE bid_id = $1 AND supplier_id = $2',
      [bid.id, supplierId]
    );
    return rowCount > 0;
  }
  return false;
}

// Create bid – min 3 suppliers, tenant_admin only
router.post('/tenants/:tid/bids', authenticate, async (req, res) => {
  if (req.user.user_type !== 'tenant_user' || req.user.role !== 'tenant_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.user.tenant_id !== req.params.tid) {
    return res.status(403).json({ error: 'Cannot create bids for another tenant' });
  }
  const tenantId = req.user.tenant_id;
  const { title, description, deadline, delivery_start, delivery_end,
          requires_large_contract, evaluation_method, bidding_fee_amount, supplier_ids } = req.body;

  const isLargeContract = requires_large_contract === true || requires_large_contract === 'true';
  const evalMethod = evaluation_method && ['lowest_price','best_value'].includes(evaluation_method) ? evaluation_method : 'lowest_price';

  if (!Array.isArray(supplier_ids) || supplier_ids.length < 3) {
    return res.status(422).json({ error: 'Minimum 3 verified suppliers required by Zambian Public Procurement Act.' });
  }
  const { rows: suppliers } = await pool.query(
    'SELECT id, verification_status, is_active FROM suppliers WHERE id = ANY($1::uuid[])', [supplier_ids]
  );
  const uniqueSupplierIds = [...new Set(supplier_ids)];
  const unverified = suppliers.filter(s => s.verification_status !== 'verified' || !s.is_active);
  if (suppliers.length !== uniqueSupplierIds.length || unverified.length) {
    return res.status(422).json({ error: 'All selected suppliers must be active and verified' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bidRes = await client.query(
      `INSERT INTO bids (tenant_id, title, description, deadline, delivery_start, delivery_end,
        requires_large_contract, evaluation_method, bidding_fee_amount, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open') RETURNING *`,
      [tenantId, title, description, deadline, delivery_start, delivery_end,
       isLargeContract, evalMethod, bidding_fee_amount, req.user.user_id]
    );
    const bid = bidRes.rows[0];
    for (const sid of uniqueSupplierIds) {
      await client.query('INSERT INTO bid_suppliers (bid_id, supplier_id) VALUES ($1,$2)', [bid.id, sid]);
    }
    await client.query('COMMIT');
    res.status(201).json(bid);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Bid creation error:', e);
    res.status(500).json({ error: 'Bid creation failed' });
  } finally {
    client.release();
  }
});

// Get bid details – increment views_count
router.get('/bids/:bidId', authenticate, async (req, res) => {
  const { bidId } = req.params;

  const { rows: [bid] } = await pool.query('SELECT * FROM bids WHERE id=$1', [bidId]);
  if (!bid) return res.status(404).json({ error: 'Not found' });
  if (!(await canAccessBid(req.user, bid))) return res.status(403).json({ error: 'Forbidden' });

  await pool.query('UPDATE bids SET views_count = views_count + 1 WHERE id = $1', [bidId]);
  bid.views_count += 1;

  const supplierId = req.user.user_type === 'supplier_user'
    ? await getSupplierIdForUser(req.user.user_id)
    : null;
  const { rows: suppliers } = await pool.query(
    `SELECT s.id, s.company_name, bs.accepted, bs.id AS bid_supplier_id
     FROM bid_suppliers bs
     JOIN suppliers s ON s.id = bs.supplier_id
     WHERE bs.bid_id = $1 AND ($2::uuid IS NULL OR bs.supplier_id = $2)`,
    [bidId, supplierId]
  );
  bid.suppliers = suppliers;

  const { rows: requirements } = await pool.query('SELECT * FROM bid_requirements WHERE bid_id=$1', [bidId]);
  bid.requirements = req.user.user_type === 'supplier_user'
    ? requirements.map(({ budget_amount, ...requirement }) => requirement)
    : requirements;

  res.json(bid);
});

// Public bid noticeboard (no auth)
router.get('/public/bids', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id, b.title, b.description, b.deadline, b.evaluation_method, b.views_count, t.name AS tenant_name
     FROM bids b JOIN tenants t ON t.id = b.tenant_id
     WHERE b.status = 'open' ORDER BY b.created_at DESC`
  );
  res.json(rows);
});

// Supplier routes (accept, respond) – unchanged
router.get('/supplier/bids', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  const { rows } = await pool.query(
    `SELECT b.id, b.title, b.description, b.deadline, bs.accepted, bs.id as bid_supplier_id
     FROM bid_suppliers bs JOIN bids b ON b.id = bs.bid_id
     WHERE bs.supplier_id = (SELECT supplier_id FROM supplier_users WHERE id = $1) AND b.status = 'open'`,
    [req.user.user_id]
  );
  res.json(rows);
});

router.post('/supplier/bids/:bidSupplierId/respond', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  const { accepted } = req.body;
  const { rowCount } = await pool.query(
    `UPDATE bid_suppliers SET accepted = $1, accepted_at = now()
     WHERE id = $2 AND supplier_id = (SELECT supplier_id FROM supplier_users WHERE id = $3)`,
    [accepted, req.params.bidSupplierId, req.user.user_id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Invitation not found' });
  res.json({ success: true });
});

router.post('/supplier/bids/:bidSupplierId/response', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  const { product_specifications, terms_conditions_accepted, file_path } = req.body;
  const { rows: [invitation] } = await pool.query(
    `SELECT id, accepted FROM bid_suppliers
     WHERE id = $1 AND supplier_id = (SELECT supplier_id FROM supplier_users WHERE id = $2)`,
    [req.params.bidSupplierId, req.user.user_id]
  );
  if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
  if (invitation.accepted !== true) return res.status(422).json({ error: 'Accept the invitation before submitting a response' });
  const { rows } = await pool.query(
    `INSERT INTO supplier_responses (bid_supplier_id, product_specifications, terms_conditions_accepted, response_file_path)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.bidSupplierId, product_specifications, terms_conditions_accepted, file_path]
  );
  res.status(201).json(rows[0]);
});

module.exports = router;
