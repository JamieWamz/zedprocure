const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { financialNoStore, requireJsonMutation } = require('../middleware/financialSecurity');
const { createNotification, notifyBusinessAdmins } = require('../services/notificationService');

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set(['technical', 'account', 'bid', 'payment', 'security', 'other']);
const PRIORITIES = new Set(['low', 'normal', 'high']);
const STATUSES = new Set(['open', 'in_progress', 'resolved', 'closed']);

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many issue reports. Please wait before submitting another.' },
});

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

function reporterHome(userType, reference) {
  const root = userType === 'supplier_user' ? '/supplier' : userType === 'tenant_user' ? '/customer' : '/admin';
  return `${root}?support=${encodeURIComponent(reference)}`;
}

function newReference() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `FS-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

router.use(financialNoStore, requireJsonMutation);

router.post('/issues', authenticate, reportLimiter, async (req, res) => {
  const category = cleanText(req.body.category, 24).toLowerCase();
  const subject = cleanText(req.body.subject, 120);
  const description = cleanText(req.body.description, 4000);
  const requestedPriority = cleanText(req.body.priority, 12).toLowerCase();
  const priority = category === 'security' ? 'high' : (PRIORITIES.has(requestedPriority) ? requestedPriority : 'normal');

  if (!CATEGORIES.has(category)) return res.status(400).json({ error: 'Select a valid issue category' });
  if (subject.length < 5) return res.status(400).json({ error: 'Subject must be at least 5 characters' });
  if (description.length < 20) return res.status(400).json({ error: 'Please provide at least 20 characters of detail' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let issue;
    for (let attempt = 0; attempt < 3 && !issue; attempt += 1) {
      const { rows } = await client.query(
          `INSERT INTO support_issues
            (reference, reporter_user_id, reporter_user_type, reporter_email, reporter_name,
             tenant_id, category, subject, description, priority)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (reference) DO NOTHING
           RETURNING id, reference, category, subject, priority, status, created_at`,
          [
            newReference(), req.user.user_id, req.user.user_type, req.user.email,
            req.user.full_name || null, req.user.tenant_id || null, category,
            subject, description, priority,
          ]
      );
      [issue] = rows;
    }
    if (!issue) throw new Error('Unable to allocate support reference');

    await client.query(
      `INSERT INTO audit_log (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1,$2,$3,'support_issue_created','support_issue',$4,$5)`,
      [req.user.user_id, req.user.user_type, req.user.email, issue.id, JSON.stringify({ reference: issue.reference, category, priority })]
    );
    await client.query('COMMIT');

    await notifyBusinessAdmins({
      type: 'support_issue',
      title: `New customer-care issue ${issue.reference}`,
      message: `A ${priority} priority ${category} issue is waiting for review.`,
      linkByRole: {
        business_admin: `/admin/support?focus=${issue.id}`,
        system_admin: `/system-health?tab=support&focus=${issue.id}`,
      },
      metadata: { support_issue_id: issue.id, reference: issue.reference },
    });

    res.status(201).json(issue);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create support issue error:', error);
    res.status(500).json({ error: 'Unable to submit the issue right now' });
  } finally {
    client.release();
  }
});

router.get('/issues/mine', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, reference, category, subject, priority, status, resolution_note, created_at, updated_at
       FROM support_issues
       WHERE reporter_user_id = $1 AND reporter_user_type = $2
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.user_id, req.user.user_type]
    );
    res.json(rows);
  } catch (error) {
    console.error('List own support issues error:', error);
    res.status(500).json({ error: 'Unable to load your submitted issues' });
  }
});

router.get('/issues', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  const status = cleanText(req.query.status, 20).toLowerCase();
  const params = [];
  const where = status && STATUSES.has(status) ? 'WHERE si.status = $1' : '';
  if (where) params.push(status);
  try {
    const { rows } = await pool.query(
      `SELECT si.*, pa.email AS assigned_admin_email, pa.full_name AS assigned_admin_name
       FROM support_issues si
       LEFT JOIN platform_admins pa ON pa.id = si.assigned_admin_id
       ${where}
       ORDER BY CASE si.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
                CASE si.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                si.created_at DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (error) {
    console.error('List support issues error:', error);
    res.status(500).json({ error: 'Unable to load customer-care issues' });
  }
});

router.put('/issues/:id', authenticate, requireRole('business_admin', 'system_admin'), async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Invalid issue identifier' });
  const status = cleanText(req.body.status, 20).toLowerCase();
  const resolutionNote = cleanText(req.body.resolution_note, 2000);
  if (!STATUSES.has(status)) return res.status(400).json({ error: 'Select a valid issue status' });
  if (['resolved', 'closed'].includes(status) && resolutionNote.length < 5) {
    return res.status(400).json({ error: 'Add a resolution note before resolving this issue' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [existing] } = await client.query('SELECT * FROM support_issues WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Issue not found' });
    }

    const { rows: [updated] } = await client.query(
      `UPDATE support_issues
       SET status = $1, resolution_note = NULLIF($2, ''), assigned_admin_id = $3,
           resolved_at = CASE WHEN $1 IN ('resolved','closed') THEN COALESCE(resolved_at, now()) ELSE NULL END,
           updated_at = now()
       WHERE id = $4 RETURNING *`,
      [status, resolutionNote, req.user.user_id, req.params.id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1,$2,$3,'support_issue_updated','support_issue',$4,$5)`,
      [req.user.user_id, req.user.user_type, req.user.email, updated.id, JSON.stringify({ reference: updated.reference, from: existing.status, to: status })]
    );
    await client.query('COMMIT');

    await createNotification({
      userId: updated.reporter_user_id,
      userType: updated.reporter_user_type,
      type: 'support_issue_update',
      title: `Issue ${updated.reference} updated`,
      message: status === 'resolved' ? 'Customer care has resolved your issue.' : `Your issue is now ${status.replace('_', ' ')}.`,
      link: reporterHome(updated.reporter_user_type, updated.reference),
      metadata: { support_issue_id: updated.id, reference: updated.reference, status },
    });
    res.json(updated);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update support issue error:', error);
    res.status(500).json({ error: 'Unable to update the issue' });
  } finally {
    client.release();
  }
});

module.exports = router;
