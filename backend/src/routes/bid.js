const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const stripBudgetForSupplier = require('../middleware/priceIsolation');
const { validateBidSubmission } = require('../services/bidSubmissionValidator');
const { consumeBidAccess, BidAccessError } = require('../services/bidFeeService');
const { calculateTransactionPricing, MonetizationError } = require('../services/monetizationService');
const { cleanText, requireUuid } = require('../utils/requestValidation');
const { notifySuppliersOnBidPublished, notifySupplierInvited, notifyBusinessAdmins } = require('../services/notificationService');
const router = express.Router();

const supplierBidLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many bid actions. Please wait before trying again.' },
});

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
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_SPEC_EXT.includes(ext) && ALLOWED_SPEC_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Bid response documents must be a PDF file'));
    }
  }
});

// Valid Incoterms for validation
const VALID_INCOTERMS = ['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DPU','DAP','DDP'];
const VALID_UOMS = ['each','kg','g','ton','meters','cm','liters','ml','sqm','sqft','hours','days','months','lump_sum','boxes','pairs','sets'];
const VALID_VISIBILITIES = ['global', 'restricted'];

function parseSupplierIds(value) {
  if (value === undefined || value === null || value === '') return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error('supplier_ids must be an array');
  const supplierIds = [...new Set(parsed)];
  supplierIds.forEach((supplierId) => requireUuid(supplierId, 'supplier_id'));
  return supplierIds;
}

async function loadAwardPricing(client, bidId, responseId, requirementId) {
  requireUuid(bidId, 'bidId');
  if (responseId) requireUuid(responseId, 'response_id');
  if (requirementId) requireUuid(requirementId, 'requirement_id');

  const responseParams = responseId ? [bidId, responseId] : [bidId];
  const responseFilter = responseId ? 'AND sr.id = $2' : '';
  const { rows: [response] } = await client.query(
    `SELECT sr.id AS response_id, bs.supplier_id,
            COALESCE(SUM(brli.total_price), 0) AS supplier_price,
            COUNT(DISTINCT brli.bid_line_item_id)::int AS priced_items,
            (SELECT COUNT(*)::int FROM bid_line_items WHERE bid_id = $1) AS required_items
     FROM supplier_responses sr
     JOIN bid_suppliers bs ON bs.id = sr.bid_supplier_id
     LEFT JOIN bid_response_line_items brli ON brli.supplier_response_id = sr.id
     WHERE bs.bid_id = $1 ${responseFilter}
     GROUP BY sr.id, bs.supplier_id
     ORDER BY sr.submitted_at DESC LIMIT 1`,
    responseParams
  );
  if (!response) throw new MonetizationError('MISSING_RESPONSE', 'A persisted supplier response is required');
  if (response.priced_items !== response.required_items || response.required_items === 0) {
    throw new MonetizationError('INCOMPLETE_RESPONSE', 'The supplier response does not price every Bill of Quantities item');
  }

  const requirementParams = requirementId ? [bidId, requirementId] : [bidId];
  const requirementFilter = requirementId ? 'AND id = $2' : '';
  const { rows: [requirement] } = await client.query(
    `SELECT id, budget_amount FROM bid_requirements
     WHERE bid_id = $1 ${requirementFilter} AND budget_amount IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    requirementParams
  );
  if (!requirement || Number(requirement.budget_amount) <= 0) {
    throw new MonetizationError('MISSING_BUYER_PRICE', 'A positive customer budget is required before award');
  }

  const { rows: [settings] } = await client.query(
    'SELECT * FROM platform_monetization_settings WHERE singleton_id = TRUE'
  );
  if (!settings) throw new Error('Platform monetization settings are missing');
  const { rows: [bid] } = await client.query(
    'SELECT express_match, express_match_fee FROM bids WHERE id = $1',
    [bidId]
  );

  const pricing = calculateTransactionPricing({
    userPrice: requirement.budget_amount,
    supplierPrice: response.supplier_price,
    escrowFeeType: settings.escrow_fee_type,
    escrowFeePercent: settings.escrow_fee_percent,
    escrowFeeFixed: settings.escrow_fee_fixed,
    expressMatch: bid.express_match,
    expressMatchFee: Number(bid.express_match_fee) || settings.express_match_fee,
    allowSubsidized: settings.allow_subsidized_transactions,
    subsidyLimit: settings.subsidy_limit,
  });
  return { response, requirement, pricing };
}

// Apply price isolation middleware to all /bids routes for supplier users
// This MUST be before any /bids routes to ensure budget_amount is stripped
router.use('/bids', authenticate, stripBudgetForSupplier);

// ─── Create bid – BoQ line items, Incoterms, tech specs ──────────────────────
// Bids are created as 'draft' and must be explicitly published.
router.post('/tenants/:tid/bids', authenticate, requireRole('business_admin'), uploadSpec.single('technical_specifications_file'), async (req, res) => {
  const tenantId = req.params.tid;
  const {
    title, description, deadline, delivery_start, delivery_end,
    requires_large_contract, evaluation_method, bidding_fee_amount,
    delivery_terms, technical_specifications,
    line_items, business_category, visibility, express_match, source_request_id, supplier_ids
  } = req.body;

  // Validate required fields
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Bid title is required' });
  }
  let safeTitle;
  let safeDescription;
  let safeTechnicalSpecifications;
  try {
    safeTitle = cleanText(title, { required: true, maxLength: 255 });
    safeDescription = cleanText(description, { maxLength: 10000 });
    safeTechnicalSpecifications = cleanText(technical_specifications, { maxLength: 20000 });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!deadline) {
    return res.status(400).json({ error: 'Bid deadline is required' });
  }
  const deadlineDate = new Date(deadline);
  const deliveryStartDate = delivery_start ? new Date(delivery_start) : null;
  const deliveryEndDate = delivery_end ? new Date(delivery_end) : null;
  if (Number.isNaN(deadlineDate.getTime()) || deadlineDate.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'Bid deadline must be a valid future date and time' });
  }
  if (deliveryStartDate && Number.isNaN(deliveryStartDate.getTime())) {
    return res.status(400).json({ error: 'Delivery start date is invalid' });
  }
  if (deliveryEndDate && Number.isNaN(deliveryEndDate.getTime())) {
    return res.status(400).json({ error: 'Delivery end date is invalid' });
  }
  if (deliveryEndDate && deliveryEndDate <= deadlineDate) {
    return res.status(400).json({ error: 'Delivery end must be after the supplier response deadline' });
  }
  if (deliveryStartDate && deliveryStartDate <= deadlineDate) {
    return res.status(400).json({ error: 'Delivery start must be after the supplier response deadline' });
  }
  if (deliveryStartDate && deliveryEndDate && deliveryStartDate > deliveryEndDate) {
    return res.status(400).json({ error: 'Delivery start must be on or before delivery end' });
  }
  if (source_request_id) {
    try {
      requireUuid(source_request_id, 'source_request_id');
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }
  if (!delivery_terms) {
    return res.status(400).json({ error: 'Delivery terms (Incoterms) is required. Valid values: ' + VALID_INCOTERMS.join(', ') });
  }
  if (!VALID_INCOTERMS.includes(delivery_terms)) {
    return res.status(400).json({ error: `Invalid delivery terms. Must be one of: ${VALID_INCOTERMS.join(', ')}` });
  }
  const bidFee = Number(bidding_fee_amount);
  if (!Number.isFinite(bidFee) || bidFee < 0 || bidFee > 1_000_000) {
    return res.status(400).json({ error: 'Bidding fee must be between 0 and 1,000,000 ZMW' });
  }

  const visibilityMode = visibility || 'global';
  if (!VALID_VISIBILITIES.includes(visibilityMode)) {
    return res.status(400).json({ error: `Visibility must be one of: ${VALID_VISIBILITIES.join(', ')}` });
  }

  let invitedSupplierIds;
  try {
    invitedSupplierIds = parseSupplierIds(supplier_ids);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (visibilityMode === 'restricted' && invitedSupplierIds.length === 0) {
    return res.status(400).json({ error: 'Invite-only bids require at least one verified supplier' });
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
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || Number(item.quantity) > 1_000_000) {
      return res.status(400).json({ error: `Line item ${i + 1}: quantity must be greater than 0` });
    }
    if (item.unit_price_estimate !== undefined && item.unit_price_estimate !== null && item.unit_price_estimate !== '') {
      const estimate = Number(item.unit_price_estimate);
      if (!Number.isFinite(estimate) || estimate < 0 || estimate > 1_000_000_000) {
        return res.status(400).json({ error: `Line item ${i + 1}: invalid unit price estimate` });
      }
    }
  }

  const isLargeContract = requires_large_contract === true || requires_large_contract === 'true';
  const evalMethod = (evaluation_method === 'best_value') ? 'best_value' : 'lowest_price';
  const techSpecPath = req.file ? req.file.path : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (source_request_id) {
      const { rows: [sourceRequest] } = await client.query(
        `SELECT id, tenant_id, status, converted_bid_id
         FROM procurement_requests WHERE id = $1 FOR UPDATE`,
        [source_request_id]
      );
      if (!sourceRequest) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Source procurement request was not found' });
      }
      if (sourceRequest.tenant_id !== tenantId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Source request does not belong to the selected organization' });
      }
      if (sourceRequest.status === 'rejected') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'A rejected request cannot be converted to a bid' });
      }
      if (sourceRequest.converted_bid_id) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This procurement request has already been converted to a bid' });
      }
    }

    const { rows: [monetizationSettings] } = await client.query(
      'SELECT express_match_fee FROM platform_monetization_settings WHERE singleton_id = TRUE'
    );
    const isExpressMatch = express_match === true || express_match === 'true';

    if (invitedSupplierIds.length > 0) {
      const { rows: eligibleSuppliers } = await client.query(
        `SELECT id FROM suppliers
         WHERE id = ANY($1::uuid[]) AND verification_status = 'verified' AND is_active = true`,
        [invitedSupplierIds]
      );
      if (eligibleSuppliers.length !== invitedSupplierIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Every invited supplier must be active and verified' });
      }
    }

    const bidRes = await client.query(
      `INSERT INTO bids (tenant_id, title, description, deadline, delivery_start, delivery_end,
        requires_large_contract, evaluation_method, bidding_fee_amount, delivery_terms,
        technical_specifications, technical_specifications_path, visibility, business_category, created_by, status,
        express_match, express_match_fee, source_request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft',$16,$17,$18) RETURNING *`,
      [
        tenantId, safeTitle, safeDescription, deadline, delivery_start || null, delivery_end || null,
        isLargeContract, evalMethod, bidFee, delivery_terms,
        safeTechnicalSpecifications, techSpecPath, visibilityMode, business_category || null, req.user.user_id,
        isExpressMatch, isExpressMatch ? Number(monetizationSettings?.express_match_fee || 0) : 0,
        source_request_id || null
      ]
    );
    const bid = bidRes.rows[0];

    for (const supplierId of invitedSupplierIds) {
      await client.query(
        `INSERT INTO bid_suppliers (bid_id, supplier_id)
         VALUES ($1, $2) ON CONFLICT (bid_id, supplier_id) DO NOTHING`,
        [bid.id, supplierId]
      );
    }

    if (source_request_id) {
      await client.query(
        `UPDATE procurement_requests
         SET status = 'converted_to_bid', converted_bid_id = $1, updated_at = now()
         WHERE id = $2`,
        [bid.id, source_request_id]
      );
    }

    // Insert line items
    for (let i = 0; i < parsedLineItems.length; i++) {
      const item = parsedLineItems[i];
      await client.query(
        `INSERT INTO bid_line_items (bid_id, item_description, unit_of_measure, quantity, unit_price_estimate, line_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bid.id, cleanText(item.item_description, { required: true, maxLength: 2000 }), item.unit_of_measure, item.quantity,
         item.unit_price_estimate || null, i + 1]
      );
    }

    // Log creation
    await client.query(
      `INSERT INTO system_logs (actor_id, actor_type, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.user_id, req.user.role, 'bid_created', 'bid', bid.id,
       JSON.stringify({
         title: bid.title,
         line_items_count: parsedLineItems.length,
         invited_suppliers_count: invitedSupplierIds.length,
       })]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...bid, line_items_count: parsedLineItems.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Bid creation error:', e);
    res.status(500).json({ error: 'Bid creation failed' });
  } finally {
    client.release();
  }
});

// ─── Publish bid – validates line items > 0, then draft → open ───────────────
router.put('/bids/:bidId/publish', authenticate, requireRole('business_admin'), async (req, res) => {

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate bid exists and is in draft state
    const { rows: [existing] } = await client.query(
      `SELECT id, title, status, visibility, delivery_terms
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

    let restrictedSupplierIds = [];
    if (existing.visibility === 'restricted') {
      const { rows: invitedSuppliers } = await client.query(
        `SELECT supplier_id FROM bid_suppliers WHERE bid_id = $1`,
        [req.params.bidId]
      );
      restrictedSupplierIds = invitedSuppliers.map(({ supplier_id }) => supplier_id);
      if (restrictedSupplierIds.length === 0) {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: 'Cannot publish an invite-only bid without at least one invited supplier.'
        });
      }
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
    } else {
      for (const supplierId of restrictedSupplierIds) {
        notifySupplierInvited(bid, supplierId).catch(err => {
          console.error('Error notifying invited supplier on bid publish:', err);
        });
      }
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

// ─── Customer: Get all active bids for my tenant ──────────────────────────────
router.get('/bids/my-tenant-bids', authenticate, async (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.title, b.description, b.deadline, b.delivery_start, b.delivery_end,
              b.delivery_terms, b.business_category,
              (SELECT COUNT(*)::int FROM bid_line_items bli WHERE bli.bid_id = b.id) AS total_line_items
       FROM bids b
       WHERE b.tenant_id = $1 AND b.status = 'open' AND b.deadline > now()
       ORDER BY b.deadline ASC`,
      [req.user.tenant_id]
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching tenant bids:', e);
    res.status(500).json({ error: 'Failed to fetch tenant bids' });
  }
});

// ─── Get bid details – includes line items, suppliers, increments views ──────
router.get('/bids/:bidId', authenticate, async (req, res) => {
  try {
    requireUuid(req.params.bidId, 'bidId');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    const { bidId } = req.params;
    
    // Select specific columns to avoid leaking sensitive data
    const { rows: [bid] } = await pool.query(
      `SELECT id, tenant_id, title, description, deadline, delivery_start, delivery_end,
              requires_large_contract, evaluation_method, bidding_fee_amount, delivery_terms,
              technical_specifications_path, technical_specifications,
              visibility, status, views_count, created_by, created_at, business_category,
              express_match, express_match_fee
       FROM bids WHERE id=$1`,
      [bidId]
    );
    if (!bid) return res.status(404).json({ error: 'Not found' });

    // Enforce authorization — platform_admins can view any bid
    if (req.user.user_type === 'tenant_user' && bid.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    } else if (req.user.user_type === 'supplier_user') {
      // Check if supplier is invited
      const { rows: [invite] } = await pool.query(
        `SELECT bs.id, bs.accepted, s.company_name, bfc.status AS fee_status,
                bfc.charge_source
         FROM bid_suppliers bs 
         JOIN suppliers s ON s.id = bs.supplier_id 
         LEFT JOIN bid_fee_charges bfc ON bfc.bid_id = bs.bid_id AND bfc.supplier_id = bs.supplier_id
         WHERE bs.bid_id = $1 AND bs.supplier_id = (SELECT supplier_id FROM supplier_users WHERE id = $2)`,
        [bidId, req.user.user_id]
      );
      const bidIsActive = ['open', 'evaluation'].includes(bid.status) && new Date(bid.deadline) > new Date();
      const supplierHasAccess = bid.visibility === 'global' || Boolean(invite);
      if (!bidIsActive || !supplierHasAccess) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      
      if (invite) {
        bid.suppliers = [{
          bid_supplier_id: invite.id,
          accepted: invite.accepted,
          company_name: invite.company_name
        }];
        bid.bid_access = {
          confirmed: invite.fee_status === 'completed' || Number(bid.bidding_fee_amount) === 0,
          source: invite.charge_source || (Number(bid.bidding_fee_amount) === 0 ? 'free' : null),
        };
      }
    }

    // Load BoQ line items (include unit_price_estimate for admin/customer views;
    // the priceIsolation middleware strips it for supplier_user responses)
    const { rows: lineItems } = await pool.query(
      `SELECT id, item_description, unit_of_measure, quantity, unit_price_estimate, line_order
       FROM bid_line_items WHERE bid_id = $1 ORDER BY line_order ASC`,
      [bidId]
    );
    bid.line_items = lineItems;
    bid.total_line_items = lineItems.length;

    // Load suppliers (only for tenant_users or admins, NOT for suppliers)
    if (req.user.user_type !== 'supplier_user') {
      const { rows: suppliers } = await pool.query(
        `SELECT s.id, s.company_name, bs.accepted, bs.id AS bid_supplier_id
         FROM bid_suppliers bs JOIN suppliers s ON s.id = bs.supplier_id WHERE bs.bid_id = $1`,
        [bidId]
      );
      bid.suppliers = suppliers;
    }

    await pool.query('UPDATE bids SET views_count = views_count + 1 WHERE id = $1', [bidId]);

    const { rows: requirements } = await pool.query(
      `SELECT id, bid_id, customer_user_id, budget_amount,
              expected_delivery_time::text AS expected_delivery_time,
              payment_method, certification_standards, specifications_file_path, created_at
       FROM bid_requirements WHERE bid_id = $1 ORDER BY created_at DESC`,
      [bidId]
    );
    bid.requirements = requirements;

    res.json(bid);
  } catch (e) {
    console.error('Error fetching bid:', e);
    res.status(500).json({ error: 'Failed to fetch bid details' });
  }
});

// ─── Customer: Submit bid requirements ───────────────────────────────────────
router.post('/bids/:bidId/requirements', authenticate, requireRole('customer'), async (req, res) => {
  const { bidId } = req.params;
  const { budget_amount, expected_delivery_time, payment_method, certification_standards, file_path } = req.body;

  const buyerBudget = Number(budget_amount);
  if (!Number.isFinite(buyerBudget) || buyerBudget <= 0 || buyerBudget > 1_000_000_000) {
    return res.status(400).json({ error: 'budget_amount must be a positive amount within the permitted range' });
  }
  let safeStandards;
  let safeFilePath;
  let safeDeliveryWindow;
  try {
    requireUuid(bidId, 'bidId');
    safeStandards = cleanText(certification_standards, { required: true, maxLength: 5000 });
    safeFilePath = cleanText(file_path, { maxLength: 500 });
    safeDeliveryWindow = cleanText(expected_delivery_time, { maxLength: 120 });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!['mtn', 'airtel', 'zamtel', 'bank_transfer', 'escrow'].includes(payment_method)) {
    return res.status(400).json({ error: 'Select a supported payment method' });
  }

  try {
    // Verify user's tenant matches the bid's tenant and fetch bid title
    const authCheck = await pool.query(
      `SELECT b.id, b.title FROM bids b
       JOIN tenant_users tu ON b.tenant_id = tu.tenant_id
       WHERE b.id = $1 AND tu.id = $2`,
      [bidId, req.user.user_id]
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this bid.' });
    }

    const bidTitle = authCheck.rows[0].title;

    const { rows } = await pool.query(
      `INSERT INTO bid_requirements (bid_id, customer_user_id, budget_amount, expected_delivery_time, payment_method, certification_standards, specifications_file_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (bid_id, customer_user_id) DO UPDATE SET
         budget_amount = EXCLUDED.budget_amount,
         expected_delivery_time = EXCLUDED.expected_delivery_time,
         payment_method = EXCLUDED.payment_method,
         certification_standards = EXCLUDED.certification_standards,
         specifications_file_path = COALESCE(EXCLUDED.specifications_file_path, bid_requirements.specifications_file_path)
       RETURNING *`,
      [bidId, req.user.user_id, buyerBudget, safeDeliveryWindow, payment_method, safeStandards, safeFilePath]
    );

    // Notify Business Admin immediately
    notifyBusinessAdmins({
      type: 'customer_requirement',
      title: `Customer Requirement Submitted: ${bidTitle}`,
      message: `Customer ${req.user.full_name || req.user.email} submitted procurement requirements for bid "${bidTitle}". Budget: ZMW ${budget_amount || 'N/A'}. Payment method: ${payment_method || 'N/A'}.`,
      link: `/admin/bids/${bidId}#customer-requirements`,
      metadata: { bid_id: bidId, customer_user_id: req.user.user_id },
    }).catch(err => console.error('Failed to send admin notification:', err));

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('Error creating bid requirement:', e);
    res.status(500).json({ error: 'Failed to create requirement: ' + e.message });
  }
});
// Admin or Tenant Admin: Edit/Update bid requirements details
router.put('/bids/:bidId/requirements/:requirementId', authenticate, async (req, res) => {
  // Only admins can edit requirements
  if (req.user.role !== 'business_admin' && req.user.role !== 'system_admin' && req.user.role !== 'tenant_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { bidId, requirementId } = req.params;
  const { budget_amount, expected_delivery_time, payment_method, certification_standards, specifications_file_path } = req.body;

  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (budget_amount !== undefined) {
      updates.push(`budget_amount = $${paramIndex++}`);
      values.push(budget_amount !== null ? Number(budget_amount) : null);
    }
    if (expected_delivery_time !== undefined) {
      updates.push(`expected_delivery_time = $${paramIndex++}`);
      values.push(expected_delivery_time);
    }
    if (payment_method !== undefined) {
      updates.push(`payment_method = $${paramIndex++}`);
      values.push(payment_method);
    }
    if (certification_standards !== undefined) {
      updates.push(`certification_standards = $${paramIndex++}`);
      values.push(certification_standards);
    }
    if (specifications_file_path !== undefined) {
      updates.push(`specifications_file_path = $${paramIndex++}`);
      values.push(specifications_file_path);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(requirementId);
    const reqIdParam = `$${paramIndex++}`;
    values.push(bidId);
    const bidIdParam = `$${paramIndex++}`;

    const queryText = `
      UPDATE bid_requirements
      SET ${updates.join(', ')}
      WHERE id = ${reqIdParam} AND bid_id = ${bidIdParam}
      RETURNING *`;

    const { rows: [updated] } = await pool.query(queryText, values);

    if (!updated) {
      return res.status(404).json({ error: 'Requirement not found for this bid' });
    }

    res.json(updated);
  } catch (e) {
    console.error('Error updating bid requirement:', e);
    res.status(500).json({ error: 'Failed to update bid requirement: ' + e.message });
  }
});

// ─── Public bid noticeboard (no auth) ─────────────────────────────────────────
router.get('/public/bids', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.title, b.description, b.deadline, b.delivery_start, b.delivery_end,
              b.evaluation_method, b.delivery_terms, b.business_category, b.express_match, b.status,
              b.views_count, t.name AS tenant_name,
              (SELECT COUNT(*)::int FROM bid_line_items bli WHERE bli.bid_id = b.id) AS total_line_items
       FROM bids b JOIN tenants t ON t.id = b.tenant_id
       WHERE b.status = 'open' AND b.visibility = 'global' AND b.deadline > now()
       ORDER BY b.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching public bids:', e);
    res.status(500).json({ error: 'Failed to fetch public bids' });
  }
});

// ─── Supplier: list my open invitations + all global open bids ────────────────
router.get('/supplier/bids', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.title, b.description, b.deadline, b.visibility,
              bs.accepted, bs.id as bid_supplier_id, b.bidding_fee_amount,
              b.express_match
       FROM bid_suppliers bs JOIN bids b ON b.id = bs.bid_id
       WHERE bs.supplier_id = (SELECT supplier_id FROM supplier_users WHERE id = $1)
       AND b.status IN ('open','evaluation') AND b.deadline > now()
       UNION
       SELECT b.id, b.title, b.description, b.deadline, b.visibility,
              NULL as accepted, NULL as bid_supplier_id, b.bidding_fee_amount,
              b.express_match
       FROM bids b
       CROSS JOIN (SELECT business_category FROM suppliers WHERE id = (SELECT supplier_id FROM supplier_users WHERE id = $1)) s
       WHERE b.status IN ('open','evaluation') AND b.deadline > now() AND b.visibility = 'global'
       AND (s.business_category IS NULL OR s.business_category = '' OR b.business_category = s.business_category OR b.business_category IS NULL)
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

// ─── Supplier: express interest in a global bid (creates invitation) ───────────
// Allows a verified supplier to join a global open bid by creating a bid_suppliers
// record, which is required before they can submit a response.
router.post('/supplier/bids/:bidId/express-interest', supplierBidLimiter, authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { bidId } = req.params;

    // 1. Bid exists, is open, and deadline hasn't passed
    const { rows: [bid] } = await pool.query(
      `SELECT id, status, deadline, title, visibility FROM bids WHERE id = $1`,
      [bidId]
    );
    if (!bid) {
      return res.status(404).json({ error: 'Bid not found' });
    }
    if (!['open', 'evaluation'].includes(bid.status)) {
      return res.status(422).json({ error: 'This bid is not currently accepting submissions' });
    }
    if (bid.visibility !== 'global') {
      return res.status(403).json({ error: 'This is an invite-only bid. Only invited suppliers can participate.' });
    }
    if (new Date() > new Date(bid.deadline)) {
      return res.status(422).json({ error: 'The deadline for this bid has passed' });
    }

    // 2. Supplier is verified
    const { rows: [supplierUser] } = await pool.query(
      `SELECT s.id AS supplier_id, s.verification_status, s.company_name
       FROM supplier_users su
       JOIN suppliers s ON s.id = su.supplier_id
       WHERE su.id = $1`,
      [req.user.user_id]
    );
    if (!supplierUser) {
      return res.status(403).json({ error: 'Supplier record not found' });
    }
    if (supplierUser.verification_status !== 'verified') {
      return res.status(403).json({
        error: 'Your supplier account must be VERIFIED before you can express interest in bids',
      });
    }

    // 3. Create bid_suppliers record if it doesn't already exist
    const { rows: [bidSupplier] } = await pool.query(
      `INSERT INTO bid_suppliers (bid_id, supplier_id, accepted, accepted_at)
       VALUES ($1, $2, NULL, NULL)
       ON CONFLICT (bid_id, supplier_id) DO UPDATE SET accepted = EXCLUDED.accepted
       RETURNING id, bid_id, supplier_id, accepted, accepted_at, invited_at`,
      [bidId, supplierUser.supplier_id]
    );

    res.status(201).json({
      success: true,
      bid_supplier_id: bidSupplier.id,
      message: `Interest expressed in "${bid.title}". You can now submit your response.`,
    });
  } catch (e) {
    console.error('Error expressing interest in bid:', e);
    res.status(500).json({ error: 'Failed to express interest: ' + e.message });
  }
});

// ─── Supplier: submit a bid response with per-line-item pricing ──────────────
router.post('/supplier/bids/:bidSupplierId/response', supplierBidLimiter, authenticate, uploadResponse.single('file'), async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { terms_conditions_accepted, line_item_prices } = req.body;
    const product_specifications = cleanText(req.body.product_specifications, { required: true, maxLength: 10000 });
    const acceptedTerms = terms_conditions_accepted === 'true' || terms_conditions_accepted === true;
    if (!acceptedTerms) return res.status(400).json({ error: 'Terms and conditions must be accepted' });
    const file_path = req.file ? req.file.path : null;

    // Check if req.params.bidSupplierId matches a bid_suppliers ID or a bid ID
    let bs;
    const { rows: [foundBs] } = await pool.query(
      `SELECT bs.id, bs.bid_id, bs.supplier_id FROM bid_suppliers bs
       JOIN supplier_users su ON su.supplier_id = bs.supplier_id
       WHERE bs.id = $1 AND su.id = $2`,
      [req.params.bidSupplierId, req.user.user_id]
    );

    if (foundBs) {
      bs = foundBs;
    } else {
      // Fallback: Check if bidSupplierId is actually a bid_id
      const { rows: [bid] } = await pool.query(
        `SELECT id, status, deadline, visibility FROM bids WHERE id = $1`,
        [req.params.bidSupplierId]
      );
      if (bid) {
        // Find supplier_id for current user
        const { rows: [sup] } = await pool.query(
          `SELECT s.id AS supplier_id, s.verification_status
           FROM supplier_users su JOIN suppliers s ON s.id = su.supplier_id
           WHERE su.id = $1`,
          [req.user.user_id]
        );
        if (bid.visibility === 'global' && sup && sup.verification_status === 'verified') {
          // Global bids allow verified suppliers to create their access record.
          const { rows: [newBs] } = await pool.query(
            `INSERT INTO bid_suppliers (bid_id, supplier_id, accepted, accepted_at)
             VALUES ($1, $2, true, now())
             ON CONFLICT (bid_id, supplier_id) DO UPDATE SET accepted = true
             RETURNING id, bid_id, supplier_id`,
            [bid.id, sup.supplier_id]
          );
          bs = newBs;
        }
      }
    }

    if (!bs) {
      return res.status(403).json({ error: 'You do not have access or verified status to submit a response for this bid' });
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

    if (parsedPrices.length !== boqItems.length) {
      return res.status(400).json({ error: 'Pricing must contain exactly one entry for every Bill of Quantities item' });
    }

    // Reject duplicate, foreign, negative, non-numeric, and unreasonably large prices.
    const priceMap = new Map();
    for (const entry of parsedPrices) {
      requireUuid(entry.bid_line_item_id, 'bid_line_item_id');
      if (priceMap.has(entry.bid_line_item_id)) {
        return res.status(400).json({ error: 'Duplicate line-item prices are not allowed' });
      }
      const unitPrice = Number(entry.unit_price);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0 || unitPrice > 1_000_000_000) {
        return res.status(400).json({ error: 'Each unit price must be greater than zero and within the permitted range' });
      }
      priceMap.set(entry.bid_line_item_id, { ...entry, unit_price: unitPrice });
    }
    let supplierTotal = 0;
    for (const boq of boqItems) {
      const price = priceMap.get(boq.id);
      if (!price || price.unit_price === undefined || Number(price.unit_price) < 0) {
        return res.status(400).json({
          error: `Missing or invalid unit price for line item: "${boq.item_description}" (qty: ${boq.quantity})`
        });
      }
      supplierTotal += Number(price.unit_price) * Number(boq.quantity);
      if (!Number.isFinite(supplierTotal) || supplierTotal > 1_000_000_000) {
        return res.status(400).json({ error: 'The total supplier quote exceeds the permitted range' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [lockedBidSupplier] } = await client.query(
        'SELECT id FROM bid_suppliers WHERE id = $1 AND bid_id = $2 FOR UPDATE',
        [bs.id, bs.bid_id]
      );
      if (!lockedBidSupplier) throw new Error('Bid supplier access changed before submission');
      await consumeBidAccess({ bidId: bs.bid_id, supplierUserId: req.user.user_id, client });

      // Insert the main response
      const { rows: [response] } = await client.query(
        `INSERT INTO supplier_responses (bid_supplier_id, product_specifications, terms_conditions_accepted, response_file_path)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [bs.id, product_specifications, acceptedTerms, file_path]
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
          [response.id, price.bid_line_item_id, unitPrice, totalPrice,
           cleanText(price.notes, { maxLength: 1000 })]
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
    const status = e instanceof BidAccessError
      ? (e.code === 'PAYMENT_REQUIRED' ? 402 : 422)
      : (e.code === '23505' ? 409 : (e.message?.includes('must be') ? 400 : 500));
    const message = e instanceof BidAccessError || status === 400
      ? e.message
      : (status === 409 ? 'A response has already been submitted for this bid' : 'Failed to submit response');
    res.status(status).json({ error: message });
  }
});

// ─── Admin: Get all supplier responses with line-item pricing for a bid ─────
router.get('/bids/:bidId/responses', authenticate, requireRole('business_admin'), async (req, res) => {
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
router.post('/bids/:bidId/evaluate', authenticate, requireRole('business_admin'), async (req, res) => {
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
router.get('/bids/:bidId/evaluation', authenticate, requireRole('business_admin'), async (req, res) => {
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


// ─── Admin / Customer: Invite suppliers to a bid ──────────────────────────────
router.post('/bids/:bidId/invite', authenticate, requireRole('business_admin', 'customer', 'system_admin'), async (req, res) => {
  const { bidId } = req.params;
  const { supplier_ids } = req.body;

  let invitedSupplierIds;
  try {
    invitedSupplierIds = parseSupplierIds(supplier_ids);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (invitedSupplierIds.length === 0) {
    return res.status(400).json({ error: '`supplier_ids` must be a non-empty array.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [bid] } = await client.query('SELECT * FROM bids WHERE id = $1 FOR UPDATE', [bidId]);
    if (!bid) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bid not found' });
    }
    if (req.user.user_type === 'tenant_user' && bid.tenant_id !== req.user.tenant_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can only invite suppliers to bids for your organization' });
    }

    const { rows: eligibleSuppliers } = await client.query(
      `SELECT id FROM suppliers
       WHERE id = ANY($1::uuid[]) AND verification_status = 'verified' AND is_active = true`,
      [invitedSupplierIds]
    );
    if (eligibleSuppliers.length !== invitedSupplierIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Every invited supplier must be active and verified' });
    }

    const invitedList = [];
    for (const sid of invitedSupplierIds) {
      const { rows: [bs] } = await client.query(
        `INSERT INTO bid_suppliers (bid_id, supplier_id, invited_at)
         VALUES ($1, $2, now())
         ON CONFLICT (bid_id, supplier_id) DO UPDATE SET invited_at = now()
         RETURNING *`,
        [bidId, sid]
      );
      invitedList.push(bs);
    }

    await client.query('COMMIT');

    if (['open', 'evaluation'].includes(bid.status)) {
      for (const sid of invitedSupplierIds) {
        notifySupplierInvited(bid, sid).catch(err => console.error('Error notifying invited supplier:', err));
      }
    }

    res.json({ success: true, count: invitedList.length, invited: invitedList });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error inviting suppliers:', e);
    res.status(500).json({ error: 'Failed to invite suppliers: ' + e.message });
  } finally {
    client.release();
  }
});

// Preview the server-authoritative checkout without exposing the raw margin.
router.post('/bids/:bidId/award-preview', authenticate, requireRole('business_admin'), async (req, res) => {
  try {
    if (!req.body.response_id) return res.status(400).json({ error: 'response_id is required' });
    const { pricing } = await loadAwardPricing(
      pool,
      req.params.bidId,
      req.body.response_id,
      req.body.requirement_id
    );
    res.json({
      buyer: {
        procurement_amount: pricing.userPrice,
        buyer_protection_fee: pricing.protectionFee,
        express_match_fee: pricing.expressMatchFee,
        total_due: pricing.buyerTotal,
      },
      supplier: {
        accepted_quote: pricing.supplierPrice,
        net_payout: pricing.supplierPayout,
      },
      subsidized: pricing.subsidized,
    });
  } catch (e) {
    const status = e instanceof MonetizationError ? 422 : 500;
    res.status(status).json({ error: e.message });
  }
});

// Award bid using persisted buyer requirements and supplier response pricing.
router.post('/bids/:bidId/award', authenticate, requireRole('business_admin'), async (req, res) => {
  const { bidId } = req.params;
  const { response_id, requirement_id } = req.body;
  if (!response_id) return res.status(400).json({ error: 'response_id is required' });
  let contract_file_path;
  let award_notes;
  try {
    contract_file_path = cleanText(req.body.contract_file_path, { maxLength: 500 });
    award_notes = cleanText(req.body.award_notes, { maxLength: 4000 });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify bid belongs to tenant
    const { rows: [bid] } = await client.query(
      'SELECT tenant_id, status, title FROM bids WHERE id = $1 FOR UPDATE',
      [bidId]
    );
    if (!bid) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bid not found' });
    }
    if (bid.status !== 'evaluation' && bid.status !== 'open') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Bid is not in awardable state. Must be in evaluation or open status.' });
    }

    // Verify tenant access
    if (req.user.tenant_id && bid.tenant_id !== req.user.tenant_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden: bid belongs to another tenant' });
    }

    const { response, requirement, pricing } = await loadAwardPricing(
      client, bidId, response_id, requirement_id
    );

    // Update bid status to awarded
    await client.query('UPDATE bids SET status = $1 WHERE id = $2', ['awarded', bidId]);

    // Create order with award metadata
    const { rows: [order] } = await client.query(
      `INSERT INTO orders (
         bid_id, awarded_supplier_id, total_amount, contract_file_path,
         award_decision_notes, awarded_by, awarded_at, buyer_price, supplier_price,
         spread_amount, buyer_protection_fee, express_match_fee, supplier_payout_amount,
         platform_revenue_amount, subsidy_amount, pricing_snapshot, supplier_response_id, bid_requirement_id
       ) VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [bidId, response.supplier_id, pricing.buyerTotal, contract_file_path,
       award_notes, req.user.user_id, pricing.userPrice, pricing.supplierPrice,
       pricing.spread, pricing.protectionFee, pricing.expressMatchFee, pricing.supplierPayout,
       pricing.platformRevenue, pricing.subsidyAmount, JSON.stringify(pricing), response.response_id, requirement.id]
    );

    // Log the award in system_logs
    await client.query(
      `INSERT INTO system_logs (actor_id, actor_type, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.user_id, 'platform_admin', 'bid_awarded', 'bid', bidId,
       JSON.stringify({
         title: bid.title,
         awarded_supplier_id: response.supplier_id,
         buyer_total: pricing.buyerTotal,
         supplier_price: pricing.supplierPrice,
         platform_revenue: pricing.platformRevenue,
         award_notes: award_notes || null,
       })]
    );

    await client.query('COMMIT');

    // Fetch the complete order with supplier name
    const { rows: [completeOrder] } = await pool.query(
      `SELECT o.*, s.company_name AS supplier_name
       FROM orders o
       JOIN suppliers s ON s.id = o.awarded_supplier_id
       WHERE o.id = $1`,
      [order.id]
    );

    res.status(201).json(completeOrder);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error awarding bid:', e);
    const status = e instanceof MonetizationError ? 422 : (e.code === '23505' ? 409 : 500);
    res.status(status).json({
      error: e instanceof MonetizationError ? e.message : (status === 409 ? 'This bid has already been awarded' : 'Failed to award bid'),
    });
  } finally {
    client.release();
  }
});

module.exports = router;
