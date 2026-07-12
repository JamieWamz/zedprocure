const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `supplier-doc-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, DOC, DOCX, JPG, PNG'));
    }
  }
});

router.post('/supplier/documents', authenticate, upload.single('file'), async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { document_type } = req.body;
    if (!document_type) return res.status(400).json({ error: 'document_type is required' });
    if (!req.file) return res.status(400).json({ error: 'File is required' });

    const file_path = req.file.path;
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
  } catch (e) {
    console.error('Error uploading document:', e);
    res.status(500).json({ error: 'Failed to upload document: ' + e.message });
  }
});

router.get('/admin/suppliers/pending', authenticate, requireRole('business_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, COALESCE(json_agg(json_build_object('id', sd.id, 'type', sd.document_type, 'path', sd.file_path)) FILTER (WHERE sd.id IS NOT NULL), '[]') as documents
       FROM suppliers s LEFT JOIN supplier_documents sd ON sd.supplier_id = s.id
       WHERE s.verification_status IN ('pending','documents_submitted')
       GROUP BY s.id`
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching pending suppliers:', e);
    res.status(500).json({ error: 'Failed to fetch pending suppliers' });
  }
});

router.put('/admin/suppliers/:id/verify', authenticate, requireRole('business_admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['verified','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await pool.query(
      `UPDATE suppliers SET verification_status = $1, is_active = $2 WHERE id = $3`,
      [status, status === 'verified', req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('Error verifying supplier:', e);
    res.status(500).json({ error: 'Failed to verify supplier' });
  }
});

module.exports = router;