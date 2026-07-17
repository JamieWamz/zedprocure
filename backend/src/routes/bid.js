const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const stripBudgetForSupplier = require('../middleware/priceIsolation');
const { validateBidSubmission } = require('../services/submissionGuard');
const { notifySuppliersOnBidPublished } = require('../services/notificationService');
const router = express.Router();

// Configure multer for response file uploads
const responseStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    crypto.randomBytes(16, (err, buf) => {
      if (err) return cb(err);
      cb(null, `response-${buf.toString('hex')}${ext}`);
    });
  }
});

const uploadResponse = multer({
  storage: responseStorage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Apply price isolation middleware to all /bids routes for supplier users
// This MUST be before any /bids routes to ensure budget_amount is stripped
router.use('/bids', authenticate, stripBudgetForSupplier);

// ─── Create bid – open marketplace: no minimum supplier requirement ───────────
// Bids are created as 'draft' and must be explicitly published.
router.post('/tenants/:tid/bids', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const tenantId = req.user.tenant_id || req.params.tid;
  const {
    title, description, deadline, delivery_start, delivery_end,
    requires_large_contract, evaluation_method, bidding_fee_amount,
    visibility, business_category
  } = req.body;

  const isLargeContract = requires_large_contract === true || requires_large_contract === 'true';
  const evalMethod = (evaluation_method === 'best_value') ? 'best_value' : 'lowest_price';
  const bidVisibility = visibility === 'restricted' ? 'restricted' : 'global';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bidRes = await client.query(
      `INSERT INTO bids (tenant_id, title, description, deadline, delivery_start, delivery_end,
        requires_large_contract, evaluation_method, bidding_fee_amount, created_by,
        status, visibility, business_category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12) RETURNING *`,
      [tenantId, title, description, deadline, delivery_start, delivery_end,
       isLargeContract, evalMethod, bidding_fee_amount, req.user.user_id,
       bidVisibility, business_category]
    );
    const bid = bidRes.rows[0];

    // Log creation
    await client.query(
      `INSERT INTO system_logs (actor_id, actor_type, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.user_id, 'platform_admin', 'bid_created', 'bid', bid.id,
       JSON.stringify({ title: bid.title, visibility: bid.visibility })]
    );

    await client.query('COMMIT');
    res.status(201).json(bid);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Bid creation error:', e);
    res.status(500).json({ error: 'Bid creation failed: ' + e.message });
  } finally {
    client.release();
  }
});

// ─── Publish bid – draft → open, notify verified suppliers ────────────────────
router.put('/bids/:bidId/publish', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [bid] } = await client.query(
      `UPDATE bids SET status = 'open'
       WHERE id = $1 AND status = 'draft'
       RETURNING *`,
      [req.params.bidId]
    );
    if (!bid) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bid not found or already published' });
    }

    // Log the publish action
    await client.query(
      `INSERT INTO system_logs (actor_id, actor_type, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.user_id, 'platform_admin', 'bid_published', 'bid', bid.id,
       JSON.stringify({ title: bid.title, visibility: bid.visibility, business_category: bid.business_category })]
    );

    await client.query('COMMIT');

    // Notify verified suppliers (non-blocking — fire and forget)
    if (bid.visibility === 'global') {
      notifySuppliersOnBidPublished(bid).catch(err => {
        console.error('Error notifying suppliers on bid publish:', err);
      });
    }

    res.json(bid);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error publishing bid:', e);
    res.status(500).json({ error: 'Failed to publish bid' });
  } finally {
    client.release();
  }
});

// ─── Get global open bids (marketplace listing for suppliers) ─────────────────
router.get('/bids/global', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.title, b.description, b.deadline, b.evaluation_method,
              b.bidding_fee_amount, b.business_category, b.views_count,
              b.created_at, t.name AS tenant_name
       FROM bids b
       JOIN tenants t ON t.id = b.tenant_id
       WHERE b.status = 'open' AND b.visibility = 'global'
       ORDER BY b.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching global bids:', e);
    res.status(500).json({ error: 'Failed to fetch global bids' });
  }
});

// ─── Get bid details – includes suppliers and requirements, increments views ──
router.get('/bids/:bidId', authenticate, async (req, res) => {
  try {
    const { bidId } = req.params;
    await pool.query('UPDATE bids SET views_count = views_count + 1 WHERE id = $1', [bidId]);
    const { rows: [bid] } = await pool.query('SELECT * FROM bids WHERE id=$1', [bidId]);
    if (!bid) return res.status(404).json({ error: 'Not found' });

    const { rows: suppliers } = await pool.query(
      `SELECT s.id, s.company_name, bs.accepted, bs.id AS bid_supplier_id
       FROM bid_suppliers bs JOIN suppliers s ON s.id = bs.supplier_id WHERE bs.bid_id = $1`,
      [bidId]
    );
    bid.suppliers = suppliers;

    const { rows: requirements } = await pool.query('SELECT * FROM bid_requirements WHERE bid_id=$1', [bidId]);
    bid.requirements = requirements;

    res.json(bid);
  } catch (e) {
    console.error('Error fetching bid:', e);
    res.status(500).json({ error: 'Failed to fetch bid details' });
  }
});

// ─── Public bid noticeboard (no auth) ─────────────────────────────────────────
router.get('/public/bids', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.title, b.description, b.deadline, b.evaluation_method,
              b.business_category, b.views_count, t.name AS tenant_name
       FROM bids b JOIN tenants t ON t.id = b.tenant_id
       WHERE b.status = 'open' ORDER BY b.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching public bids:', e);
    res.status(500).json({ error: 'Failed to fetch public bids' });
  }
});

// ─── Supplier: list my open invitations + matching global bids ────────────────
router.get('/supplier/bids', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.title, b.description, b.deadline, b.visibility,
              bs.accepted, bs.id as bid_supplier_id
       FROM bid_suppliers bs JOIN bids b ON b.id = bs.bid_id
       WHERE bs.supplier_id = (SELECT supplier_id FROM supplier_users WHERE id = $1)
       AND b.status = 'open'
       UNION
       SELECT b.id, b.title, b.description, b.deadline, b.visibility,
              NULL as accepted, NULL as bid_supplier_id
       FROM bids b
       WHERE b.status = 'open' AND b.visibility = 'global'
         AND b.business_category = (SELECT s.business_category FROM suppliers s
                                     JOIN supplier_users su ON su.supplier_id = s.id
                                     WHERE su.id = $1)
       ORDER BY deadline ASC`,
      [req.user.user_id]
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching supplier bids:', e);
    res.status(500).json({ error: 'Failed to fetch supplier bids' });
  }
});

// ─── Supplier: accept/decline a bid invitation ────────────────────────────────
router.post('/supplier/bids/:bidSupplierId/respond', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { accepted } = req.body;
    await pool.query(
      `UPDATE bid_suppliers SET accepted = $1, accepted_at = now()
       WHERE id = $2 AND supplier_id = (SELECT supplier_id FROM supplier_users WHERE id = $3)`,
      [accepted, req.params.bidSupplierId, req.user.user_id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('Error responding to bid:', e);
    res.status(500).json({ error: 'Failed to respond to bid' });
  }
});

// ─── Supplier: submit a bid response (with file upload) ───────────────────────
router.post('/supplier/bids/:bidSupplierId/response', authenticate, uploadResponse.single('file'), async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { product_specifications, terms_conditions_accepted } = req.body;
    const file_path = req.file ? req.file.path : null;

    // Ensure the bid_supplier_id belongs to the current user's supplier record
    const { rows: [bs] } = await pool.query(
      `SELECT bs.id, bs.bid_id FROM bid_suppliers bs
       JOIN supplier_users su ON su.supplier_id = bs.supplier_id
       WHERE bs.id = $1 AND su.id = $2`,
      [req.params.bidSupplierId, req.user.user_id]
    );
    if (!bs) {
      return res.status(403).json({ error: 'You do not have access to submit a response for this bid invitation' });
    }

    // Run submission guardrails
    const guard = await validateBidSubmission(bs.bid_id, req.user.user_id);
    if (!guard.valid) {
      return res.status(422).json({ error: guard.errors.join('; ') });
    }

    const { rows } = await pool.query(
      `INSERT INTO supplier_responses (bid_supplier_id, product_specifications, terms_conditions_accepted, response_file_path)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.bidSupplierId, product_specifications, terms_conditions_accepted === 'true' || terms_conditions_accepted === true, file_path]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('Error submitting response:', e);
    res.status(500).json({ error: 'Failed to submit response' });
  }
});

module.exports = router;
