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

const commentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many support replies. Please wait before adding another.' },
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

function isSupportAdmin(user) {
  return user.user_type === 'platform_admin' && ['business_admin', 'system_admin'].includes(user.role);
}

function canAccessIssue(issue, user) {
  return isSupportAdmin(user) || (
    issue.reporter_user_id === user.user_id && issue.reporter_user_type === user.user_type
  );
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
      `SELECT si.id, si.reference, si.category, si.subject, si.description, si.priority,
              si.status, si.resolution_note, si.created_at, si.updated_at,
              COUNT(sic.id)::int AS comment_count,
              MAX(sic.created_at) AS latest_comment_at
       FROM support_issues si
       LEFT JOIN support_issue_comments sic ON sic.issue_id = si.id
       WHERE si.reporter_user_id = $1 AND si.reporter_user_type = $2
       GROUP BY si.id
       ORDER BY GREATEST(si.updated_at, COALESCE(MAX(sic.created_at), si.created_at)) DESC
       LIMIT 20`,
      [req.user.user_id, req.user.user_type]
    );
    res.json(rows);
  } catch (error) {
    console.error('List own support issues error:', error);
    res.status(500).json({ error: 'Unable to load your submitted issues' });
  }
});

router.get('/issues/:id/comments', authenticate, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Invalid issue identifier' });
  try {
    const { rows: [issue] } = await pool.query(
      `SELECT id, reporter_user_id, reporter_user_type
       FROM support_issues WHERE id = $1`,
      [req.params.id]
    );
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    if (!canAccessIssue(issue, req.user)) return res.status(403).json({ error: 'You cannot view this conversation' });

    const { rows } = await pool.query(
      `SELECT id, issue_id, author_user_id, author_user_type, author_name, author_email, body, created_at
       FROM support_issue_comments
       WHERE issue_id = $1
       ORDER BY created_at ASC, id ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('List support comments error:', error);
    res.status(500).json({ error: 'Unable to load the issue conversation' });
  }
});

router.post('/issues/:id/comments', authenticate, commentLimiter, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Invalid issue identifier' });
  const body = cleanText(req.body.body, 4000);
  if (body.length < 2) return res.status(400).json({ error: 'Enter at least 2 characters for your reply' });

  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const { rows: [issue] } = await client.query(
      'SELECT * FROM support_issues WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (!issue) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Issue not found' });
    }
    if (!canAccessIssue(issue, req.user)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot reply to this issue' });
    }

    const adminReply = isSupportAdmin(req.user);
    const { rows: [comment] } = await client.query(
      `INSERT INTO support_issue_comments
         (issue_id, author_user_id, author_user_type, author_name, author_email, body)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, issue_id, author_user_id, author_user_type, author_name, author_email, body, created_at`,
      [req.params.id, req.user.user_id, req.user.user_type, req.user.full_name || null, req.user.email, body]
    );

    const { rows: [updated] } = adminReply
      ? await client.query(
          `UPDATE support_issues
           SET status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
               assigned_admin_id = $1, updated_at = now()
           WHERE id = $2 RETURNING status`,
          [req.user.user_id, req.params.id]
        )
      : await client.query(
          `UPDATE support_issues
           SET status = CASE WHEN status IN ('resolved','closed') THEN 'open' ELSE status END,
               resolved_at = CASE WHEN status IN ('resolved','closed') THEN NULL ELSE resolved_at END,
               updated_at = now()
           WHERE id = $1 RETURNING status`,
          [req.params.id]
        );

    await client.query(
      `INSERT INTO audit_log (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1,$2,$3,'support_issue_comment_added','support_issue',$4,$5)`,
      [req.user.user_id, req.user.user_type, req.user.email, issue.id,
        JSON.stringify({ reference: issue.reference, comment_id: comment.id, resulting_status: updated.status })]
    );
    await client.query('COMMIT');
    committed = true;

    try {
      if (adminReply) {
        await createNotification({
          userId: issue.reporter_user_id,
          userType: issue.reporter_user_type,
          type: 'support_issue_comment',
          title: `Customer care replied to ${issue.reference}`,
          message: 'A new response was added to your customer-care issue.',
          link: reporterHome(issue.reporter_user_type, issue.reference),
          metadata: { support_issue_id: issue.id, reference: issue.reference, status: updated.status },
        });
      } else {
        await notifyBusinessAdmins({
          type: 'support_issue_reply',
          title: `Customer replied to ${issue.reference}`,
          message: 'A new customer reply is waiting in the customer-care conversation.',
          linkByRole: {
            business_admin: `/admin/support?focus=${issue.id}`,
            system_admin: `/system-health?tab=support&focus=${issue.id}`,
          },
          metadata: { support_issue_id: issue.id, reference: issue.reference, status: updated.status },
        });
      }
    } catch (notificationError) {
      console.error('Support comment notification error:', notificationError);
    }

    res.status(201).json({ comment, status: updated.status });
  } catch (error) {
    if (!committed) {
      try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
    }
    console.error('Create support comment error:', error);
    res.status(500).json({ error: 'Unable to add the reply' });
  } finally {
    client.release();
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
  let committed = false;
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
    committed = true;

    try {
      await createNotification({
        userId: updated.reporter_user_id,
        userType: updated.reporter_user_type,
        type: 'support_issue_update',
        title: `Issue ${updated.reference} updated`,
        message: status === 'resolved' ? 'Customer care has resolved your issue.' : `Your issue is now ${status.replace('_', ' ')}.`,
        link: reporterHome(updated.reporter_user_type, updated.reference),
        metadata: { support_issue_id: updated.id, reference: updated.reference, status },
      });
    } catch (notificationError) {
      console.error('Support issue update notification error:', notificationError);
    }
    res.json(updated);
  } catch (error) {
    if (!committed) {
      try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
    }
    console.error('Update support issue error:', error);
    res.status(500).json({ error: 'Unable to update the issue' });
  } finally {
    client.release();
  }
});

module.exports = router;
