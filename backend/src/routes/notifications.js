/**
 * Notifications API Routes
 * Endpoints for fetching and managing in-app notifications.
 */
const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

// ─── Get current user's notifications ─────────────────────────────────────────
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, title, message, link, is_read, created_at
       FROM notifications
       WHERE user_id = $1 AND user_type = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.user_id, req.user.user_type]
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching notifications:', e);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ─── Get unread count ─────────────────────────────────────────────────────────
router.get('/notifications/unread-count', authenticate, async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM notifications
       WHERE user_id = $1 AND user_type = $2 AND is_read = false`,
      [req.user.user_id, req.user.user_type]
    );
    res.json({ count: row.count });
  } catch (e) {
    console.error('Error fetching unread count:', e);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

// ─── Mark a single notification as read ───────────────────────────────────────
router.put('/notifications/:id/read', authenticate, async (req, res) => {
  try {
    const { rows: [updated] } = await pool.query(
      `UPDATE notifications SET is_read = true
       WHERE id = $1 AND user_id = $2 AND user_type = $3
       RETURNING id, is_read`,
      [req.params.id, req.user.user_id, req.user.user_type]
    );
    if (!updated) return res.status(404).json({ error: 'Notification not found' });
    res.json(updated);
  } catch (e) {
    console.error('Error marking notification as read:', e);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// ─── Mark all notifications as read ───────────────────────────────────────────
router.put('/notifications/read-all', authenticate, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE notifications SET is_read = true
       WHERE user_id = $1 AND user_type = $2 AND is_read = false`,
      [req.user.user_id, req.user.user_type]
    );
    res.json({ success: true, updated: rowCount });
  } catch (e) {
    console.error('Error marking all notifications as read:', e);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

module.exports = router;
