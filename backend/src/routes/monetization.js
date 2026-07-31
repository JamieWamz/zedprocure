const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { requireEnum, requireUuid } = require('../utils/requestValidation');

const router = express.Router();

router.get('/monetization/settings', authenticate, requireRole('business_admin', 'system_admin'), async (_req, res) => {
  try {
    const { rows: [settings] } = await pool.query(
      'SELECT * FROM platform_monetization_settings WHERE singleton_id = TRUE'
    );
    res.json(settings);
  } catch (e) {
    console.error('Failed to load monetization settings:', e);
    res.status(500).json({ error: 'Failed to load monetization settings' });
  }
});

router.put('/monetization/settings', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  const allowed = {
    escrow_fee_type: 'enum',
    escrow_fee_percent: 'percent',
    escrow_fee_fixed: 'money',
    express_match_fee: 'money',
    withdrawal_fee_percent: 'percent',
    withdrawal_fee_fixed: 'money',
    allow_subsidized_transactions: 'boolean',
    subsidy_limit: 'money',
  };
  const updates = [];
  const values = [];
  try {
    for (const [field, kind] of Object.entries(allowed)) {
      if (req.body[field] === undefined) continue;
      let value = req.body[field];
      if (kind === 'enum') value = requireEnum(value, ['percentage', 'fixed'], field);
      if (kind === 'boolean' && typeof value !== 'boolean') throw new Error(`${field} must be a boolean`);
      if (kind === 'money' || kind === 'percent') {
        value = Number(value);
        const max = kind === 'percent' ? 100 : 1_000_000_000;
        if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`${field} is outside the permitted range`);
      }
      values.push(value);
      updates.push(`${field} = $${values.length}`);
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!updates.length) return res.status(400).json({ error: 'No supported settings were supplied' });

  try {
    const { rows: [settings] } = await pool.query(
      `UPDATE platform_monetization_settings
       SET ${updates.join(', ')}, updated_at = now()
       WHERE singleton_id = TRUE RETURNING *`,
      values
    );
    await pool.query(
      `INSERT INTO system_logs (actor_id, actor_type, action, entity_type, metadata)
       VALUES ($1,$2,'monetization_settings_updated','platform_monetization_settings',$3)`,
      [req.user.user_id, req.user.user_type, JSON.stringify({ changed_fields: Object.keys(req.body).filter(k => allowed[k]) })]
    );
    res.json(settings);
  } catch (e) {
    console.error('Failed to update monetization settings:', e);
    res.status(500).json({ error: 'Failed to update monetization settings' });
  }
});

router.get('/supplier/subscription', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows: [subscription] } = await pool.query(
      `SELECT ss.* FROM supplier_users su
       LEFT JOIN supplier_subscriptions ss ON ss.supplier_id = su.supplier_id
       WHERE su.id = $1`,
      [req.user.user_id]
    );
    res.json(subscription?.id ? subscription : {
      tier: 'free', monthly_bid_limit: 0, bids_used: 0, bid_credits: 0, active: true,
    });
  } catch {
    res.status(500).json({ error: 'Failed to load subscription' });
  }
});

router.put('/admin/suppliers/:supplierId/subscription', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  try {
    const supplierId = requireUuid(req.params.supplierId, 'supplierId');
    const tier = requireEnum(req.body.tier, ['free', 'growth', 'enterprise'], 'tier');
    const monthlyBidLimit = Number(req.body.monthly_bid_limit);
    const bidCredits = Number(req.body.bid_credits || 0);
    if (!Number.isInteger(monthlyBidLimit) || monthlyBidLimit < 0 || monthlyBidLimit > 100000 ||
        !Number.isInteger(bidCredits) || bidCredits < 0 || bidCredits > 100000) {
      return res.status(400).json({ error: 'Bid limits and credits must be non-negative integers' });
    }
    const { rows: [subscription] } = await pool.query(
      `INSERT INTO supplier_subscriptions (supplier_id, tier, monthly_bid_limit, bid_credits, active)
       VALUES ($1,$2,$3,$4,TRUE)
       ON CONFLICT (supplier_id) DO UPDATE SET tier = EXCLUDED.tier,
         monthly_bid_limit = EXCLUDED.monthly_bid_limit, bid_credits = EXCLUDED.bid_credits,
         active = TRUE, updated_at = now()
       RETURNING *`,
      [supplierId, tier, monthlyBidLimit, bidCredits]
    );
    res.json(subscription);
  } catch (e) {
    const status = e.message?.includes('must be') ? 400 : 500;
    res.status(status).json({ error: status === 400 ? e.message : 'Failed to update subscription' });
  }
});

module.exports = router;
