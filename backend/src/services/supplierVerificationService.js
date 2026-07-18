/**
 * Supplier Verification Service
 *
 * Handles atomic supplier verification (approve/reject) with:
 * - Database transaction
 * - Dual audit trail (audit_log + system_logs)
 * - Cache invalidation hooks
 * - Automated account activation notification
 */

const pool = require('../config/db');
const { notifyVerificationDecision } = require('./notificationService');

/**
 * Approve a supplier for marketplace participation.
 * Updates supplier record, verifies all pending documents,
 * writes to both audit trails, invalidates cache, and triggers
 * the account activation notification.
 *
 * @param {string} supplierId - UUID of the supplier
 * @param {string} adminUserId - UUID of the approving admin
 * @param {string} adminEmail - Email of the approving admin
 * @param {string} adminName - Full name of the approving admin
 * @param {string|null} notes - Optional verification notes
 * @returns {Promise<{success: boolean, supplier: object}>}
 */
async function approveSupplier(supplierId, adminUserId, adminEmail, adminName, notes) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Update supplier record atomically
    const { rows: [supplier] } = await client.query(
      `UPDATE suppliers
       SET verification_status = 'verified',
           is_active = true,
           verified_date = now(),
           last_verified_at = now(),
           verification_notes = $1
       WHERE id = $2
         AND verification_status IN ('pending', 'documents_submitted')
       RETURNING id, company_name, registration_number, verification_status, verified_date`,
      [notes || null, supplierId]
    );

    if (!supplier) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error('Supplier not found or already processed'), { statusCode: 404 });
    }

    // 2. Bulk-verify all pending documents for this supplier
    await client.query(
      `UPDATE supplier_documents
       SET verification_status = 'verified',
           verified_by = $1,
           verified_at = now(),
           verification_notes = COALESCE(verification_notes, 'Auto-verified on supplier approval')
       WHERE supplier_id = $2
         AND verification_status IN ('pending', 'pending_review')`,
      [adminUserId, supplierId]
    );

    // 3. Write to audit_log (retained for queryability)
    await client.query(
      `INSERT INTO audit_log (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1, 'platform_admin', $2, 'supplier_verified', 'supplier', $3, $4)`,
      [adminUserId, adminEmail, supplierId,
       JSON.stringify({
         notes,
         verified_by: adminName,
         verified_date: new Date().toISOString(),
         supplier_name: supplier.company_name
       })]
    );

    // 4. Write to system_logs (immutable, revoke-update-delete protected)
    await client.query(
      `INSERT INTO system_logs (actor_id, actor_type, action, entity_type, entity_id, metadata)
       VALUES ($1, 'platform_admin', 'supplier_verified', 'supplier', $2, $3)`,
      [adminUserId, supplierId,
       JSON.stringify({
         notes,
         verified_by: adminName,
         supplier_name: supplier.company_name
       })]
    );

    // 5. Cache invalidation (if Redis or in-memory cache is attached)
    if (global.cache && typeof global.cache.del === 'function') {
      try {
        await Promise.all([
          global.cache.del(`supplier:${supplierId}`),
          global.cache.del('suppliers:pending'),
          global.cache.del('suppliers:verified'),
        ]);
      } catch (cacheErr) {
        console.warn('Cache invalidation warning:', cacheErr.message);
      }
    }

    await client.query('COMMIT');

    // 6. Send account activation notification (non-blocking, out of transaction)
    notifyVerificationDecision(supplierId, 'verified', notes, adminName)
      .catch(err => console.error('Approval notification error:', err));

    return { success: true, supplier };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Reject a supplier's verification application.
 * Sets status to rejected, keeps the supplier inactive, and
 * logs the decision to both audit trails.
 *
 * @param {string} supplierId - UUID of the supplier
 * @param {string} adminUserId - UUID of the rejecting admin
 * @param {string} adminEmail - Email of the rejecting admin
 * @param {string} adminName - Full name of the rejecting admin
 * @param {string|null} notes - Required reason for rejection
 * @returns {Promise<{success: boolean, supplier: object}>}
 */
async function rejectSupplier(supplierId, adminUserId, adminEmail, adminName, notes) {
  if (!notes || notes.trim().length === 0) {
    throw Object.assign(
      new Error('Rejection reason (notes) is required when rejecting a supplier'),
      { statusCode: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [supplier] } = await client.query(
      `UPDATE suppliers
       SET verification_status = 'rejected',
           is_active = false,
           last_verified_at = now(),
           verification_notes = $1
       WHERE id = $2
         AND verification_status IN ('pending', 'documents_submitted')
       RETURNING id, company_name, registration_number, verification_status`,
      [notes.trim(), supplierId]
    );

    if (!supplier) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error('Supplier not found or already processed'), { statusCode: 404 });
    }

    await client.query(
      `INSERT INTO audit_log (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1, 'platform_admin', $2, 'supplier_rejected', 'supplier', $3, $4)`,
      [adminUserId, adminEmail, supplierId,
       JSON.stringify({ notes, rejected_by: adminName })]
    );

    await client.query(
      `INSERT INTO system_logs (actor_id, actor_type, action, entity_type, entity_id, metadata)
       VALUES ($1, 'platform_admin', 'supplier_rejected', 'supplier', $2, $3)`,
      [adminUserId, supplierId,
       JSON.stringify({ notes, rejected_by: adminName, supplier_name: supplier.company_name })]
    );

    if (global.cache && typeof global.cache.del === 'function') {
      try {
        await Promise.all([
          global.cache.del(`supplier:${supplierId}`),
          global.cache.del('suppliers:pending'),
        ]);
      } catch (cacheErr) {
        console.warn('Cache invalidation warning:', cacheErr.message);
      }
    }

    await client.query('COMMIT');

    notifyVerificationDecision(supplierId, 'rejected', notes, adminName)
      .catch(err => console.error('Rejection notification error:', err));

    return { success: true, supplier };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  approveSupplier,
  rejectSupplier,
};