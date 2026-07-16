const express = require('express');
const pool = require('../config/db');
const router = express.Router();

/**
 * A simple, unauthenticated health check endpoint for Render.
 * It verifies database connectivity to ensure the service is fully operational.
 */
router.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      db: 'connected',
    });
  } catch (e) {
    console.error('Health check failed:', e.message);
    res.status(503).json({
      status: 'unhealthy',
      db: 'disconnected',
    });
  }
});

module.exports = router;