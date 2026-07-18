/**
 * Supplier Verification Service
 * 
 * This service now supports manual verification only.
 * Suppliers must upload required documents (PACRA, ZRA, etc.) during registration.
 * Business admin manually reviews and approves/rejects suppliers.
 * 
 * The automated PACRA/ZRA API verification has been removed.
 */

const pool = require('../config/db');

// ─── Document Validator ───────────────────────────────────────────────────────
class DocumentValidator {
  /**
   * Validate document format and basic content.
   * @param {object} document - document record from DB
   * @returns {Promise<{passed: boolean, checks: Array}>}
   */
  async validate(document) {
    const checks = [];

    // Check file exists and has valid extension
    const ext = document.file_path ? document.file_path.split('.').pop().toLowerCase() : '';
    const allowedExts = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
    checks.push({
      check: 'file_format',
      passed: allowedExts.includes(ext),
      detail: `File format: .${ext} (${allowedExts.includes(ext) ? 'accepted' : 'rejected'})`,
    });

    // Check document type is categorized
    const knownTypes = [
      'pacra_certificate', 'zra_tpin', 'zra_tax_clearance',
      'business_license', 'directors_id', 'bank_reference',
      'certificate_of_incorporation', 'tax_clearance', 'vat_certificate',
      'tpin_certificate', 'directors_list', 'audited_accounts',
      'insurance_certificate', 'nppa_registration', 'company_profile',
      'procurement_history'
    ];
    checks.push({
      check: 'document_type',
      passed: knownTypes.includes(document.document_type),
      detail: `Document type: ${document.document_type} (${knownTypes.includes(document.document_type) ? 'recognized' : 'custom type'})`,
    });

    // Check expiry if present
    if (document.expiry_date) {
      const expired = new Date(document.expiry_date) < new Date();
      checks.push({
        check: 'expiry',
        passed: !expired,
        detail: `Expiry: ${document.expiry_date} (${expired ? 'EXPIRED' : 'valid'})`,
      });
    }

    const allPassed = checks.every(c => c.passed);
    return { passed: allPassed, checks };
  }
}

// ─── Manual Verification Helper ───────────────────────────────────────────────
class ManualVerification {
  /**
   * Get all required document types for Zambian suppliers.
   */
  async getRequiredDocumentTypes() {
    const { rows } = await pool.query(
      `SELECT document_type, display_name, description FROM required_document_types 
       WHERE is_active = true ORDER BY sort_order`,
    );
    return rows;
  }

  /**
   * Check if supplier has all required documents uploaded.
   * Now respects document_category: only checks documents marked as 'required'.
   */
  async checkRequiredDocuments(supplierId) {
    const { rows: [supplier] } = await pool.query(
      `SELECT s.*, 
              COALESCE(json_agg(json_build_object(
                'id', sd.id, 'type', sd.document_type, 'path', sd.file_path,
                'verification_status', sd.verification_status,
                'document_category', sd.document_category,
                'verification_notes', sd.verification_notes
              )) FILTER (WHERE sd.id IS NOT NULL), '[]') as documents
       FROM suppliers s
       LEFT JOIN supplier_documents sd ON sd.supplier_id = s.id
       WHERE s.id = $1
       GROUP BY s.id`,
      [supplierId]
    );

    if (!supplier) return { hasAllRequired: false, missing: [], documents: [], optionalMissing: [] };

    // Core mandatory document types for Zambian suppliers
    const mandatoryTypes = [
      'pacra_certificate',
      'zra_tpin',
      'zra_tax_clearance',
      'business_license',
      'directors_id',
      'bank_reference'
    ];

    // Also pull required types from the dynamic required_document_types table
    // that have is_active = true and are seeded as 'required' category
    const { rows: dbRequiredTypes } = await pool.query(
      `SELECT document_type FROM required_document_types WHERE is_active = true ORDER BY sort_order`
    );
    const allRequiredTypes = [...new Set([
      ...mandatoryTypes,
      ...dbRequiredTypes.map(r => r.document_type)
    ])];

    // Separate into required vs optional categories
    const requiredDocs = supplier.documents?.filter(
      d => d.document_category === 'required' || d.document_category === null
    ) || [];

    const missing = allRequiredTypes.filter(
      type => !requiredDocs.find(d => d.type === type)
    );

    // Optional document types that are not uploaded
    const optionalTypes = [
      'audited_accounts',
      'insurance_certificate',
      'nppa_registration',
      'company_profile',
      'procurement_history'
    ];
    const optionalMissing = optionalTypes.filter(
      type => !supplier.documents?.find(d => d.type === type)
    );

    // Count documents by verification status
    const pendingReview = supplier.documents?.filter(d => d.verification_status === 'pending_review' || d.verification_status === 'pending').length || 0;
    const verified = supplier.documents?.filter(d => d.verification_status === 'verified').length || 0;
    const rejected = supplier.documents?.filter(d => d.verification_status === 'rejected').length || 0;

    return {
      hasAllRequired: missing.length === 0,
      missing,
      optionalMissing,
      documents: supplier.documents || [],
      summary: {
        total: supplier.documents?.length || 0,
        pendingReview,
        verified,
        rejected,
      }
    };
  }

  /**
   * Get a summary breakdown of uploaded documents grouped by category and status.
   */
  async getUploadedDocumentSummary(supplierId) {
    const { rows: documents } = await pool.query(
      `SELECT document_type, document_category, verification_status
       FROM supplier_documents
       WHERE supplier_id = $1
       ORDER BY document_category, document_type`,
      [supplierId]
    );

    return {
      required: documents.filter(d => d.document_category === 'required'),
      supplementary: documents.filter(d => d.document_category === 'supplementary'),
      optional: documents.filter(d => d.document_category === 'optional'),
    };
  }
}

// Singleton
const documentValidator = new DocumentValidator();
const manualVerification = new ManualVerification();

module.exports = {
  documentValidator,
  manualVerification,
};