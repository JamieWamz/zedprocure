const pool = require('../config/db');

/**
 * Fetches bids for a user's organizational context.
 * - If the user is a business_admin without a tenant_id, it returns all bids across all tenants.
 * - Otherwise, it returns bids for the user's current tenant_id.
 *
 * @param {object} user - The authenticated user object from the request.
 * @returns {Promise<Array>} A promise that resolves to an array of bid objects.
 * @throws {Error} Throws an error if the user is missing a required tenant context.
 */
async function getOrganizationBids(user) {
  // Business admin without a specific tenant context sees ALL bids.
  if (user.role === 'business_admin' && !user.tenant_id) {
    const result = await pool.query(
      `SELECT b.*, t.name AS tenant_name FROM bids b
       JOIN tenants t ON t.id = b.tenant_id ORDER BY b.created_at DESC`
    );
    return result.rows;
  }

  // Customer or Admin with tenant context sees bids for their organization.
  const tenantId = user.tenant_id;
  if (!tenantId) {
    throw new Error('Organization context not set. Please select a workspace.');
  }
  const result = await pool.query(
    'SELECT * FROM bids WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId]
  );
  return result.rows;
}

module.exports = {
  getOrganizationBids,
};
