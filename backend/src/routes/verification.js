/**
 * Supplier Verification Routes
 * 
 * Endpoints for manual supplier verification by business admin.
 * Suppliers must upload required documents (PACRA, ZRA, etc.) during registration.
 * Business admin reviews and approves/rejects suppliers manually.
 */

const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { notifyVerificationDecision } = require('../services/notificationService');
const router = express.Router();

// ─── Admin: Get all suppliers with their verification status ─────────────────
router.get('/admin/verification/suppliers', authenticate, requireRole('business_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.company_name, s.registration_number, s.verification_status, 
              s.is_active, s.created_at, s.verification_notes,
              COALESCE(json_agg(json_build_object(
                'id', sd.id, 'type', sd.document_type, 'path', sd.file_path,
                'verification_status', sd.verification_status, 'document_category', sd.document_category,
                'verification_notes', sd.verification_notes
              )) FILTER (WHERE sd.id IS NOT NULL), '[]') as documents
       FROM suppliers s
       LEFT JOIN supplier_documents sd ON sd.supplier_id = s.id
       WHERE s.verification_status IN ('pending', 'documents_submitted')
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching verification suppliers:', e);
    res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
});

// ─── Admin: Get all required document types ─────────────────────────────────
router.get('/admin/verification/document-types', authenticate, requireRole('business_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT document_type, display_name, description FROM required_document_types 
       WHERE is_active = true ORDER BY sort_order`,
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching document types:', e);
    res.status(500).json({ error: 'Failed to fetch document types' });
  }
});

// ─── Admin: Verify a supplier (manual approval) ─────────────────────────────
router.put('/admin/suppliers/:id/verify', authenticate, requireRole('business_admin'), async (req, res) => {
  const { status, notes } = req.body;
  if (!['verified', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be verified or rejected.' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Update supplier status
    const { rows: [updated] } = await client.query(
      `UPDATE suppliers 
       SET verification_status = $1, 
           is_active = $2, 
           verification_notes = $3,
           last_verified_at = now()
       WHERE id = $4
       RETURNING id, company_name, verification_status, is_active`,
      [status, status === 'verified', notes || null, req.params.id]
    );
    
    if (!updated) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Supplier not found' });
    }
    
    // Log the verification action
    await client.query(
      `INSERT INTO audit_log (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.user_id, 'platform_admin', req.user.email, 
       `supplier_${status}`, 'supplier', req.params.id, 
       JSON.stringify({ notes, verified_by: req.user.full_name })]
    );
    
    // Log to system_logs
    await client.query(
      `INSERT INTO system_logs (actor_id, actor_type, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.user_id, 'platform_admin', `supplier_${status}`, 'supplier', req.params.id,
       JSON.stringify({ notes, verified_by: req.user.full_name })]
    );
    
    await client.query('COMMIT');

    // Send notifications (non-blocking)
    notifyVerificationDecision(req.params.id, status, notes, req.user.full_name).catch(err => {
      console.error('Error sending verification notification:', err);
    });

    res.json({ 
      success: true, 
      message: `Supplier ${status} successfully`,
      supplier: updated 
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error verifying supplier:', e);
    res.status(500).json({ error: 'Failed to verify supplier' });
  } finally {
    client.release();
  }
});

// ─── Admin: Verify individual document ─────────────────────────────────────
router.put('/admin/suppliers/:supplierId/documents/:documentId/verify', 
  authenticate, requireRole('business_admin'), async (req, res) => {
  const { status, notes } = req.body;
  if (!['verified', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  try {
    const { rows: [updated] } = await pool.query(
      `UPDATE supplier_documents 
       SET verification_status = $1, 
           verified_by = $2, 
           verified_at = now(),
           verification_notes = $3
       WHERE id = $4 AND supplier_id = $5
       RETURNING *`,
      [status, req.user.user_id, notes || null, req.params.documentId, req.params.supplierId]
    );
    
    if (!updated) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    res.json({ success: true, document: updated });
  } catch (e) {
    console.error('Error verifying document:', e);
    res.status(500).json({ error: 'Failed to verify document' });
  }
});

// ─── Supplier: Get my verification status ───────────────────────────────────
router.get('/supplier/verification/status', authenticate, async (req, res) => {
  if (req.user.user_type !== 'supplier_user') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // Get supplier id for this user
    const { rows: [su] } = await pool.query(
      'SELECT supplier_id FROM supplier_users WHERE id = $1',
      [req.user.user_id]
    );
    if (!su) return res.status(404).json({ error: 'Supplier record not found' });

    const supplierId = su.supplier_id;

    // Get supplier profile with documents
    const { rows: [supplier] } = await pool.query(
      `SELECT s.*, 
              COALESCE(json_agg(json_build_object(
                'id', sd.id, 'type', sd.document_type, 'path', sd.file_path,
                'verification_status', sd.verification_status, 'document_category', sd.document_category,
                'verification_notes', sd.verification_notes
              )) FILTER (WHERE sd.id IS NOT NULL), '[]') as documents
       FROM suppliers s
       LEFT JOIN supplier_documents sd ON sd.supplier_id = s.id
       WHERE s.id = $1
       GROUP BY s.id`,
      [supplierId]
    );
    
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    res.json(supplier);
  } catch (e) {
    console.error('Error fetching supplier verification status:', e);
    res.status(500).json({ error: 'Failed to fetch verification status' });
  }
});

// ─── Admin: Update supplier TPIN / VAT (for verification data entry) ─────────
router.put('/admin/suppliers/:id/verification-data', authenticate, requireRole('business_admin'), async (req, res) => {
  try {
    const { tpin, vat_number } = req.body;

    const { rows: [updated] } = await pool.query(
      `UPDATE suppliers
       SET tpin = COALESCE($1, tpin),
           vat_number = COALESCE($2, vat_number)
       WHERE id = $3
       RETURNING id, company_name, registration_number, tpin, vat_number, verification_status`,
      [tpin, vat_number, req.params.id]
    );

    if (!updated) return res.status(404).json({ error: 'Supplier not found' });

    res.json(updated);
  } catch (e) {
    console.error('Error updating verification data:', e);
    res.status(500).json({ error: 'Failed to update verification data' });
  }
});

// ─── Admin: Get a summary dashboard of verification statistics ───────────────
router.get('/admin/verification/stats', authenticate, requireRole('business_admin'), async (req, res) => {
  try {
    const [totalRes, pendingRes, verifiedRes, rejectedRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as count FROM suppliers'),
      pool.query("SELECT COUNT(*)::int as count FROM suppliers WHERE verification_status IN ('pending', 'documents_submitted')"),
      pool.query("SELECT COUNT(*)::int as count FROM suppliers WHERE verification_status = 'verified'"),
      pool.query("SELECT COUNT(*)::int as count FROM suppliers WHERE verification_status = 'rejected'"),
    ]);

    res.json({
      total: totalRes.rows[0].count,
      pending: pendingRes.rows[0].count,
      verified: verifiedRes.rows[0].count,
      rejected: rejectedRes.rows[0].count,
    });
  } catch (e) {
    console.error('Error fetching verification stats:', e);
    res.status(500).json({ error: 'Failed to fetch verification statistics' });
  }
});

module.exports = router;