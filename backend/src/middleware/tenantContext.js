/**
 * Middleware to validate and enforce tenant context on API requests.
 *
 * Reads the X-Tenant-ID header (injected by the frontend axios interceptor)
 * and validates that:
 *   1. The header is present for tenant-scoped operations
 *   2. The user belongs to the specified tenant (for tenant_user roles)
 *   3. For business_admin users, the tenant exists and is active
 *
 * If tenant context is missing, returns a clear error prompting the user
 * to select a workspace/organization.
 */

const pool = require('../config/db');

/**
 * Middleware that requires a valid tenant context (X-Tenant-ID header).
 * Use on routes that need tenant isolation (bid creation, document uploads, etc.)
 */
function requireTenantContext(req, res, next) {
  const tenantId = req.headers['x-tenant-id'] || req.headers['X-Tenant-ID'];

  if (!tenantId) {
    return res.status(400).json({
      error: 'Select a Workspace/Organization before proceeding. Please choose an organization from the header dropdown.',
    });
  }

  // Attach to request for downstream use
  req.tenantId = tenantId;
  next();
}

/**
 * Middleware that validates the user has access to the given tenant.
 * Must be used after `authenticate` middleware.
 * For tenant_user roles, verifies the user's tenant_id matches.
 * For business_admin/system_admin, verifies the tenant exists.
 */
async function validateTenantAccess(req, res, next) {
  const tenantId = req.headers['x-tenant-id'] || req.headers['X-Tenant-ID'] || req.tenantId;

  if (!tenantId) {
    return res.status(400).json({
      error: 'Select a Workspace/Organization before proceeding. Please choose an organization from the header dropdown.',
    });
  }

  try {
    // For tenant users, verify they belong to this tenant
    if (req.user && req.user.user_type === 'tenant_user') {
      if (String(req.user.tenant_id) !== String(tenantId)) {
        return res.status(403).json({
          error: 'You do not have access to this organization. Please select the correct Workspace/Organization.',
        });
      }
    }

    // For business_admin/system_admin, verify the tenant exists
    if (req.user && (req.user.role === 'business_admin' || req.user.role === 'system_admin')) {
      const { rows } = await pool.query(
        'SELECT id, is_active FROM tenants WHERE id = $1',
        [tenantId]
      );
      if (!rows.length) {
        return res.status(404).json({
          error: 'Organization not found. Please select a valid Workspace/Organization.',
        });
      }
      if (!rows[0].is_active) {
        return res.status(403).json({
          error: 'This organization is currently inactive. Please contact support or select another Workspace/Organization.',
        });
      }
    }

    // Attach tenantId to request for downstream use
    req.tenantId = tenantId;
    next();
  } catch (e) {
    console.error('Tenant validation error:', e);
    return res.status(500).json({ error: 'Failed to validate organization context' });
  }
}

module.exports = { requireTenantContext, validateTenantAccess };