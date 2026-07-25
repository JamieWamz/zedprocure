/**
 * Current User Profile Route
 * Extracted from inline route in index.js for architectural consistency.
 * Returns the authenticated user's profile and dashboard routing info.
 */
const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  let route = '/login';
  let tenantId = req.user.tenant_id;

  if (req.user.user_type === 'platform_admin' && req.user.role === 'system_admin') route = '/system-health';
  else if (req.user.user_type === 'platform_admin') route = '/admin';
  else if (req.user.user_type === 'tenant_user') route = '/customer';
  else if (req.user.user_type === 'supplier_user') route = '/supplier';

  res.json({
    dashboardRoute: route,
    tenantId,
    role: req.user.role,
    user_type: req.user.user_type,
    email: req.user.email,
    full_name: req.user.full_name,
  });
});

module.exports = router;