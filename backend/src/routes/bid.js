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

// ─── Multer configuration ────────────────────────────────────────────────────
const ALLOWED_SPEC_EXT = ['.pdf'];
const ALLOWED_SPEC_MIME = ['application/pdf'];

const specStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    crypto.randomBytes(16, (err, buf) => {
      if (err) return cb(err);
      cb(null, `tech-spec-${buf.toString('hex')}${ext}`);
    });
  }
});

const uploadSpec = multer({
  storage: specStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_SPEC_EXT.includes(ext) && ALLOWED_SPEC_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Technical specifications must be a PDF file'));
    }
  }
});

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

// Valid Incoterms for validation
const VALID_INCOTERMS = ['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DPU','DAP','DDP'];
const VALID_UOMS = ['each','kg','g','ton','meters','cm','liters','ml','sqm','sqft','hours','days','months','lump_sum','boxes','pairs','sets'];

// Apply price isolation middleware to all /bids routes for supplier users
// This MUST be before any /bids routes to ensure budget_amount is stripped
router.use('/bids', authenticate, stripBudgetForSupplier);

// ─── Create bid – BoQ line items, Incoterms, tech specs ──────────────────────
// Bids are created as 'draft' and must be explicitly published.
router.post('/tenants/:tid/bids', authenticate, uploadSpec.single('technical_specifications_file'), async (req, res) => {
  if (!['business_admin', 'system_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const tenantId = req.user.tenant_id || req.params.tid;
  const {
    title, description, deadline, delivery_start, delivery_end,
    requires_large_contract, evaluation_method, bidding_fee_amount,
    visibility, business_category,
    delivery_terms, technical_specifications,
    line_items
  } = req.body;

  // Validate required fields
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Bid title is required' });
  }
  if (!deadline) {
    return res.status(400).json({ error: 'Bid deadline is required' });
  }
  if (!delivery_terms) {
    return res.status(400).json({ error: 'Delivery terms (Incoterms) is required. Valid values: ' + VALID_INCOTERMS.join(', ') });
  }
  if (!VALID_INCOTERMS.includes(delivery_terms)) {
    return res.status(400).json({ error: `Invalid delivery terms. Must be one of: ${VALID_INCOTERMS.join(', ')}` });
  }

  // Parse line_items from body (may be JSON string from FormData)
  let parsedLineItems = [];
  try {
    parsedLineItems = typeof line_items === 'string' ? JSON.parse(line_items) : (line_items || []);
  } catch {
    return res.status(400).json({ error: 'Invalid line_items format. Must be a JSON array.' });
  }

  if (!Array.isArray(parsedLineItems) || parsedLineItems.length === 0) {
    return res.status(400).json({ error: 'At least one line item is required in the Bill of Quantities' });
  }

  // Validate each line item
  for (let i = 0; i < parsedLineItems.length; i++) {
    const item = parsedLineItems[i];
    if (!item.item_description || !item.item_description.trim()) {
      return res.status(400).json({ error: `Line item ${i + 1}: item_description is required` });
    }
    if (!item.unit_of_measure || !VALID_UOMS.includes(item.unit_of_measure)) {
      return res.status(400).json({ error: `Line item ${i + 1}: unit_of_measure must be one of: ${VALID_UOMS.join(', ')}` });
    }
    if (!item.quantity || Number(item.quantity) <= 0) {
      return res.status(400).json({ error: `Line item ${i + 1}: quantity must be greater than 0` });
    }
  }

  const isLargeContract = requires_large_contract === true || requires_large_contract === 'true';
  const evalMethod = (evaluation_method === 'best_value') ? 'best_value' : 'lowest_price';
  const bidVisibility = visibility === 'restricted' ? 'restricted' : 'global';
  const techSpecPath = req.file ? req.file.path : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bidRes = await client.query(
      `INSERT INTO bids (tenant_id, title, description, deadline, delivery_start, delivery_end,
        requires_large_contract, evaluation_method, bidding_fee_amount, created_by,
        status, visibility, business_category,
        delivery_terms, technical_specifications_path, technical_specifications)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12,$13,$14,$15) RETURNING *`,
      [tenantId, title, description, deadline, delivery_start, delivery_end,
       isLargeContract, evalMethod, bidding_fee_amount, req.user.user_id,
       bidVisibility, business_category,
       delivery_terms, techSpecPath, technical_specifications || null]
    );
    const bid = bidRes.rows[0];

    // Insert line items
    for (let i = 0; i < parsedLineItems.length; i++) {
      const item = parsedLineItems[i];
      await client.query(
        `INSERT INTO bid_line_items (bid_id, item_description, unit_of_measure, quantity, unit_price_estimate, line_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bid.id, item.item_description.trim(), item.unit_of_measure, item.quantity,
         item.unit_price_estimate || null, i + 1]
      );
    }

    // Log creation
    await client.query(
      `INSERT INTO system_logs (actor_id, actor_type, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.user_id, req.user.role, 'bid_created', 'bid', bid.id,
       JSON.stringify({ title: bid.title, visibility: bid.visibility, line_items_count: parsedLineItems.length })]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...bid, line_items_count: parsedLineItems.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Bid creation error:', e);
    res.status(500).json({ error: 'Bid creation failed: ' + e.message });
  } finally {
    client.release();
  }
});

// ─── Publish bid – validates line items > 0, then draft → open ───────────────
router.put('/bids/:bidId/publish', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate bid exists and is in draft state
    const { rows: [existing] } = await client.query(
      `SELECT id, title, status, visibility, business_category, delivery_terms
       FROM bids WHERE id = $1 AND status = 'draft'`,
      [req.params.bidId]
    );
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bid not found or already published' });
    }

    // Validate at least one line item exists
    const { rows: [lineCount] } = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM bid_line_items WHERE bid_id = $1`,
      [req.params.bidId]
    );
    if (!lineCount || lineCount.cnt === 0) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Cannot publish bid without line items. Add at least one line item to the Bill of Quantities before publishing.'
      });
    }

    // Validate delivery_terms is set
    if (!existing.delivery_terms) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Cannot publish bid without delivery terms (Incoterms). Please set delivery terms before publishing.'
      });
    }

    // Publish the bid
    const { rows: [bid] } = await client.query(
      `UPDATE bids SET status = 'open'
       WHERE id = $1 AND status = 'draft'
       RETURNING *`,
      [req.params.bidId]
    );

    // Log the publish action
    await client.query(
      `INSERT INTO system_logs (actor_id, actor_type, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.user_id, 'platform_admin', 'bid_published', 'bid', bid.id,
       JSON.stringify({
         title: bid.title,
         visibility: bid.visibility,
         business_category: bid.business_category,
         line_items_count: lineCount.cnt,
         delivery_terms: bid.delivery_terms
       })]
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

// ─── Get bid details – includes line items, suppliers, increments views ──────
router.get('/bids/:bidId', authenticate, async (req, res) => {
  try {
    const { bidId } = req.params;
    await pool.query('UPDATE bids SET views_count = views_count + 1 WHERE id = $1', [bidId]);
    const { rows: [bid] } = await pool.query('SELECT * FROM bids WHERE id=$1', [bidId]);
    if (!bid) return res.status(404).json({ error: 'Not found' });

    // Load BoQ line items
    const { rows: lineItems } = await pool.query(
      `SELECT id, item_description, unit_of_measure, quantity, unit_price_estimate, line_order
       FROM bid_line_items WHERE bid_id = $1 ORDER BY line_order ASC`,
      [bidId]
    );
    bid.line_items = lineItems;
    bid.total_line_items = lineItems.length;

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

// ─── Customer: Submit bid requirements ───────────────────────────────────────
router.post('/bids/:bidId/requirements', authenticate, async (req, res) => {
  // Only customer users can submit requirements
  if (req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { bidId } = req.params;
  const { budget_amount, expected_delivery_time, payment_method, certification_standards } = req.body;

  // Basic validation
  if (!bidId) {
    return res.status(400).json({ error: 'Bid ID is required' });
  }

  try {
    // Check if bid exists and belongs to the customer's tenant
    const { rows: [bid] } = await pool.query(
      `SELECT id FROM bids WHERE id = $1 AND tenant_id = $2`,
      [bidId, req.user.tenant_id]
    );

    if (!bid) {
      return res.status(404).json({ error: 'Bid not found or you do not have access' });
    }

    // Insert or update bid requirements
    const { rows: [requirement] } = await pool.query(
      `INSERT INTO bid_requirements (bid_id, customer_user_id, budget_amount, expected_delivery_time, payment_method, certification_standards)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (bid_id, customer_user_id) DO UPDATE SET
         budget_amount = EXCLUDED.budget_amount,
         expected_delivery_time = EXCLUDED.expected_delivery_time,
         payment_method = EXCLUDED.payment_method,
         certification_standards = EXCLUDED.certification_standards
       RETURNING *`,
      [
        bidId,
        req.user.user_id,
        budget_amount ? Number(budget_amount) : null,
        expected_delivery_time || null, // Assuming INTERVAL is handled as text for now
        payment_method || null,
        certification_standards || null,
      ]
    );

    res.status(200).json(requirement);
  } catch (e) {
    console.error('Error submitting bid requirements:', e);
    res.status(500).json({ error: 'Failed to submit bid requirements: ' + e.message });
  }
});

// ─── Public bid noticeboard (no auth) ─────────────────────────────────────────
router.get('/public/bids', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.title, b.description, b.deadline, b.evaluation_method,
              b.business_category, b.delivery_terms, b.views_count, t.name AS tenant_name
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

// ─── Supplier: submit a bid response with per-line-item pricing ──────────────
router.post('/supplier/bids/:bidSupplierId/response', authenticate, uploadResponse.single('file'), async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { product_specifications, terms_conditions_accepted, line_item_prices } = req.body;
    const file_path = req.file ? req.file.path : null;

    // Ensure the bid_supplier_id belongs to the current user's supplier record
    const { rows: [bs] } = await pool.query(
      `SELECT bs.id, bs.bid_id, bs.supplier_id FROM bid_suppliers bs
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

    // Parse line_item_prices (may be JSON string from FormData)
    let parsedPrices = [];
    try {
      parsedPrices = typeof line_item_prices === 'string' ? JSON.parse(line_item_prices) : (line_item_prices || []);
    } catch {
      return res.status(400).json({ error: 'Invalid line_item_prices format. Must be a JSON array.' });
    }

    // Validate that all BoQ line items have a price
    const { rows: boqItems } = await pool.query(
      `SELECT id, item_description, quantity FROM bid_line_items WHERE bid_id = $1 ORDER BY line_order`,
      [bs.bid_id]
    );

    if (boqItems.length > 0 && parsedPrices.length === 0) {
      return res.status(400).json({
        error: 'This bid requires per-line-item pricing. Please provide unit prices for all line items in the Bill of Quantities.'
      });
    }

    // Validate each price entry
    const priceMap = new Map(parsedPrices.map(p => [p.bid_line_item_id, p]));
    for (const boq of boqItems) {
      const price = priceMap.get(boq.id);
      if (!price || price.unit_price === undefined || Number(price.unit_price) < 0) {
        return res.status(400).json({
          error: `Missing or invalid unit price for line item: "${boq.item_description}" (qty: ${boq.quantity})`
        });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert the main response
      const { rows: [response] } = await client.query(
        `INSERT INTO supplier_responses (bid_supplier_id, product_specifications, terms_conditions_accepted, response_file_path)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.params.bidSupplierId, product_specifications,
         terms_conditions_accepted === 'true' || terms_conditions_accepted === true, file_path]
      );

      // Insert per-line-item pricing
      for (const price of parsedPrices) {
        const boqItem = boqItems.find(b => b.id === price.bid_line_item_id);
        if (!boqItem) continue; // Skip if BoQ item not found

        const unitPrice = Number(price.unit_price);
        const totalPrice = unitPrice * Number(boqItem.quantity);

        await client.query(
          `INSERT INTO bid_response_line_items (supplier_response_id, bid_line_item_id, unit_price, total_price, notes)
           VALUES ($1, $2, $3, $4, $5)`,
          [response.id, price.bid_line_item_id, unitPrice, totalPrice, price.notes || null]
        );
      }

      // Update bid status to 'evaluation' if it was 'open'
      await client.query(
        `UPDATE bids SET status = CASE WHEN status = 'open' THEN 'evaluation' ELSE status END
         WHERE id = $1`,
        [bs.bid_id]
      );

      await client.query('COMMIT');

      // Fetch the complete response with line items
      const { rows: [completeResponse] } = await pool.query(
        `SELECT sr.*,
                COALESCE(json_agg(json_build_object(
                  'id', brli.id, 'bid_line_item_id', brli.bid_line_item_id,
                  'unit_price', brli.unit_price, 'total_price', brli.total_price,
                  'notes', brli.notes,
                  'item_description', bli.item_description,
                  'unit_of_measure', bli.unit_of_measure,
                  'quantity', bli.quantity
                )) FILTER (WHERE brli.id IS NOT NULL), '[]') as line_item_prices
         FROM supplier_responses sr
         LEFT JOIN bid_response_line_items brli ON brli.supplier_response_id = sr.id
         LEFT JOIN bid_line_items bli ON bli.id = brli.bid_line_item_id
         WHERE sr.id = $1
         GROUP BY sr.id`,
        [response.id]
      );

      res.status(201).json(completeResponse);
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Error submitting response:', e);
    res.status(500).json({ error: 'Failed to submit response: ' + e.message });
  }
});

// ─── Admin: Get all supplier responses with line-item pricing for a bid ─────
router.get('/bids/:bidId/responses', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { bidId } = req.params;

    // Get all BoQ line items for reference
    const { rows: boqItems } = await pool.query(
      `SELECT id, item_description, unit_of_measure, quantity, line_order
       FROM bid_line_items WHERE bid_id = $1 ORDER BY line_order`,
      [bidId]
    );

    // Get all supplier responses with pricing
    const { rows: responses } = await pool.query(
      `SELECT sr.id, sr.product_specifications, sr.terms_conditions_accepted,
              sr.response_file_path, sr.submitted_at,
              s.id AS supplier_id, s.company_name AS supplier_name,
              COALESCE(json_agg(json_build_object(
                'id', brli.id, 'bid_line_item_id', brli.bid_line_item_id,
                'unit_price', brli.unit_price, 'total_price', brli.total_price,
                'notes', brli.notes
              )) FILTER (WHERE brli.id IS NOT NULL), '[]') as line_item_prices
       FROM supplier_responses sr
       JOIN bid_suppliers bs ON bs.id = sr.bid_supplier_id
       JOIN suppliers s ON s.id = bs.supplier_id
       LEFT JOIN bid_response_line_items brli ON brli.supplier_response_id = sr.id
       WHERE bs.bid_id = $1
       GROUP BY sr.id, s.id, s.company_name
       ORDER BY sr.submitted_at DESC`,
      [bidId]
    );

    // Calculate totals for each response
    const enrichedResponses = responses.map(r => {
      const total = (r.line_item_prices || []).reduce((sum, li) => sum + Number(li.total_price || 0), 0);
      return { ...r, total_price: total, line_items_count: (r.line_item_prices || []).length };
    });

    res.json({ boq_items: boqItems, responses: enrichedResponses });
  } catch (e) {
    console.error('Error fetching bid responses:', e);
    res.status(500).json({ error: 'Failed to fetch bid responses' });
  }
});

// ─── Admin: Score a supplier response (best-value evaluation) ───────────────
router.post('/bids/:bidId/evaluate', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { bidId } = req.params;
    const { supplier_id, criteria_name, score, weight, comments } = req.body;

    if (!supplier_id || !criteria_name || score === undefined) {
      return res.status(400).json({ error: 'supplier_id, criteria_name, and score are required' });
    }
    if (Number(score) < 0 || Number(score) > 100) {
      return res.status(400).json({ error: 'Score must be between 0 and 100' });
    }

    const { rows: [evalScore] } = await pool.query(
      `INSERT INTO bid_evaluation_scores (bid_id, supplier_id, criteria_name, score, weight, comments, scored_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (bid_id, supplier_id, criteria_name)
       DO UPDATE SET score = $4, weight = $5, comments = $6, scored_by = $7, created_at = now()
       RETURNING *`,
      [bidId, supplier_id, criteria_name, Number(score), Number(weight || 1), comments || null, req.user.user_id]
    );

    res.status(201).json(evalScore);
  } catch (e) {
    console.error('Error scoring supplier:', e);
    res.status(500).json({ error: 'Failed to score supplier: ' + e.message });
  }
});

// ─── Admin: Get evaluation scores for a bid ─────────────────────────────────
router.get('/bids/:bidId/evaluation', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { bidId } = req.params;

    const { rows: scores } = await pool.query(
      `SELECT bes.*, s.company_name AS supplier_name
       FROM bid_evaluation_scores bes
       JOIN suppliers s ON s.id = bes.supplier_id
       WHERE bes.bid_id = $1
       ORDER BY s.company_name, bes.criteria_name`,
      [bidId]
    );

    // Aggregate scores by supplier
    const supplierScores = {};
    for (const s of scores) {
      if (!supplierScores[s.supplier_id]) {
        supplierScores[s.supplier_id] = {
          supplier_id: s.supplier_id,
          supplier_name: s.supplier_name,
          criteria: [],
          weighted_score_sum: 0,
          total_weight: 0,
        };
      }
      supplierScores[s.supplier_id].criteria.push(s);
      supplierScores[s.supplier_id].weighted_score_sum += Number(s.score) * Number(s.weight);
      supplierScores[s.supplier_id].total_weight += Number(s.weight);
    }

    res.json(Object.values(supplierScores));
  } catch (e) {
    console.error('Error fetching evaluation:', e);
    res.status(500).json({ error: 'Failed to fetch evaluation scores' });
  }
});

// ─── Customer: Get all active bids for my tenant ──────────────────────────────
router.get('/bids/my-tenant-bids', authenticate, async (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, title, deadline
       FROM bids
       WHERE tenant_id = $1 AND status IN ('open', 'evaluation', 'awarded')
       ORDER BY deadline DESC`,
      [req.user.tenant_id]
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching tenant bids:', e);
    res.status(500).json({ error: 'Failed to fetch tenant bids' });
  }
});

module.exports = router;
