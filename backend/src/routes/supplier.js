const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/supplier/documents', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  const { document_type, file_path } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO supplier_documents (supplier_id, document_type, file_path)
     SELECT supplier_id, $1, $2 FROM supplier_users WHERE id = $3 RETURNING *`,
    [document_type, file_path, req.user.user_id]
  );
  await pool.query(
    `UPDATE suppliers SET verification_status = 'documents_submitted' WHERE id = (SELECT supplier_id FROM supplier_users WHERE id = $1)`,
    [req.user.user_id]
  );
  res.status(201).json(rows[0]);
});

router.get('/admin/suppliers/pending', authenticate, requireRole('business_admin'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, COALESCE(json_agg(json_build_object('id', sd.id, 'type', sd.document_type, 'path', sd.file_path)) FILTER (WHERE sd.id IS NOT NULL), '[]') as documents
     FROM suppliers s LEFT JOIN supplier_documents sd ON sd.supplier_id = s.id
     WHERE s.verification_status IN ('pending','documents_submitted')
     GROUP BY s.id`
  );
  res.json(rows);
});

router.put('/admin/suppliers/:id/verify', authenticate, requireRole('business_admin'), async (req, res) => {
  const { status } = req.body;
  if (!['verified','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  await pool.query(
    `UPDATE suppliers SET verification_status = $1, is_active = $2 WHERE id = $3`,
    [status, status === 'verified', req.params.id]
  );
  res.json({ success: true });
});

module.exports = router;
