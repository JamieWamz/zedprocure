/**
 * Submission Guard
 * Centralized validation for bid submissions in the open marketplace.
 * Rejects submissions past deadline or from unverified suppliers.
 */
const pool = require('../config/db');

/**
 * Validate whether a supplier can submit a bid response.
 * @param {string} bidId - The bid UUID
 * @param {string} supplierUserId - The supplier_user UUID
 * @returns {Promise<{valid: boolean, errors: string[], supplierId?: string}>}
 */
async function validateBidSubmission(bidId, supplierUserId) {
  const errors = [];

  // 1. Bid exists and is open
  const { rows: [bid] } = await pool.query(
    'SELECT id, status, deadline, title FROM bids WHERE id = $1',
    [bidId]
  );
  if (!bid) {
    errors.push('Bid not found');
    return { valid: false, errors };
  }
  if (bid.status !== 'open') {
    errors.push('Bid is not currently accepting submissions');
  }

  // 2. Deadline check — reject if current time > deadline
  if (new Date() > new Date(bid.deadline)) {
    errors.push('Bid deadline has passed');
  }

  // 3. Supplier is VERIFIED
  const { rows: [supplierUser] } = await pool.query(
    `SELECT s.verification_status, s.id as supplier_id, s.company_name
     FROM supplier_users su
     JOIN suppliers s ON s.id = su.supplier_id
     WHERE su.id = $1`,
    [supplierUserId]
  );
  if (!supplierUser) {
    errors.push('Supplier record not found');
    return { valid: false, errors };
  }

  if (supplierUser.verification_status !== 'verified') {
    errors.push('Your supplier account must be VERIFIED before submitting bids');
  }

  return {
    valid: errors.length === 0,
    errors,
    supplierId: supplierUser.supplier_id,
  };
}

module.exports = { validateBidSubmission };
