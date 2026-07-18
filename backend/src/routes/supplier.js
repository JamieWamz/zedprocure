const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    crypto.randomBytes(16, (err, buf) => {
      if (err) return cb(err);
      cb(null, `supplier-doc-${buf.toString('hex')}${ext}`);
    });
  }
});

// Validate by both extension and reported MIME type.
const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
const ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
];

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.includes(ext) && ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, DOC, DOCX, JPG, PNG'));
    }
  }
});

// All valid document types for Zambian suppliers
const VALID_DOCUMENT_TYPES = [
  'pacra_certificate',
  'zra_tpin',
  'zra_tax_clearance',
  'business_license',
  'directors_id',
  'bank_reference',
  'certificate_of_incorporation',
  'tax_clearance',
  'vat_certificate',
  'tpin_certificate',
  'directors_list',
  'audited_accounts',
  'insurance_certificate',
  'nppa_registration',
  'company_profile',
  'procurement_history'
];

router.post('/supplier/documents', authenticate, upload.array('files', 10), async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    // Accept either single 'document_type' (applied to all files) or
    // parallel array 'document_types[]' for per-file classification
    const documentTypes = req.body.document_types
      ? (Array.isArray(req.body.document_types) ? req.body.document_types : [req.body.document_types])
      : [req.body.document_type || 'company_profile'];

    // Determine document category: 'required' for core docs, 'supplementary' otherwise
    const requiredTypes = [
      'pacra_certificate','zra_tpin','zra_tax_clearance','business_license',
      'directors_id','bank_reference','certificate_of_incorporation','tax_clearance',
      'tpin_certificate'
    ];

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least one file is required' });
    }

    // Validate each file has a corresponding document type
    for (let i = 0; i < req.files.length; i++) {
      const docType = documentTypes[i] || documentTypes[documentTypes.length - 1] || 'company_profile';
      if (!VALID_DOCUMENT_TYPES.includes(docType)) {
        return res.status(400).json({
          error: `File "${req.files[i].originalname}": Invalid document type "${docType}". Valid types: ${VALID_DOCUMENT_TYPES.join(', ')}`
        });
      }

      const ext = path.extname(req.files[i].originalname).toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) {
        return res.status(400).json({
          error: `File "${req.files[i].originalname}": Invalid file format ".${ext}". Allowed: PDF, DOC, DOCX, JPG, PNG`
        });
      }
    }

    const insertedDocuments = [];

    // Use a transaction for atomic multi-insert
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const docType = documentTypes[i] || documentTypes[documentTypes.length - 1] || 'company_profile';
        const category = requiredTypes.includes(docType) ? 'required' : 'supplementary';

        const { rows } = await client.query(
          `INSERT INTO supplier_documents (supplier_id, document_type, file_path, document_category, verification_status)
           SELECT su.supplier_id, $1, $2, $3, 'pending_review'
           FROM supplier_users su WHERE su.id = $4
           RETURNING *`,
          [docType, file.path, category, req.user.user_id]
        );
        insertedDocuments.push(rows[0]);
      }

      // Update supplier status if currently 'pending'
      await client.query(
        `UPDATE suppliers
         SET verification_status = CASE WHEN verification_status = 'pending' THEN 'documents_submitted' ELSE verification_status END
         WHERE id = (SELECT supplier_id FROM supplier_users WHERE id = $1)`,
        [req.user.user_id]
      );

      await client.query('COMMIT');
      res.status(201).json({ documents: insertedDocuments, count: insertedDocuments.length });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Error uploading documents:', e);
    res.status(500).json({ error: 'Failed to upload document(s): ' + e.message });
  }
});

// ─── Get all valid document types ───────────────────────────────────────────
router.get('/supplier/document-types', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT document_type, display_name, description FROM required_document_types 
       WHERE is_active = true ORDER BY sort_order`,
    );
    // Also include any document types that might not be in the table
    const allTypes = [...rows];
    const extraTypes = VALID_DOCUMENT_TYPES.filter(t => !rows.find(r => r.document_type === t));
    for (const type of extraTypes) {
      allTypes.push({ document_type: type, display_name: type.replace(/_/g, ' ') });
    }
    res.json(allTypes);
  } catch (e) {
    console.error('Error fetching document types:', e);
    res.status(500).json({ error: 'Failed to fetch document types' });
  }
});

router.get('/supplier/profile', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows: [profile] } = await pool.query(
      `SELECT s.id, s.company_name, s.registration_number, s.verification_status, s.is_active, s.created_at,
              su.email, su.full_name
       FROM supplier_users su
       JOIN suppliers s ON s.id = su.supplier_id
       WHERE su.id = $1`,
      [req.user.user_id]
    );
    if (!profile) return res.status(404).json({ error: 'Supplier profile not found' });
    const { rows: documents } = await pool.query(
      `SELECT id, document_type, verification_status, upload_date
       FROM supplier_documents
       WHERE supplier_id = $1
       ORDER BY upload_date DESC`,
      [profile.id]
    );
    res.json({ ...profile, documents });
  } catch (e) {
    console.error('Error loading supplier profile:', e);
    res.status(500).json({ error: 'Failed to load supplier profile' });
  }
});

// ─── Get pending suppliers (backward compatibility) ───────────────────────────
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

module.exports = router;
