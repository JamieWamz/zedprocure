const express = require('express');
const rateLimit = require('express-rate-limit');
const { processVerifiedWebhook } = require('../services/webhookService');
const { logger } = require('../services/financialLogger');

const router = express.Router();
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Webhook rate limit exceeded' },
});

async function receive(req, res) {
  try {
    const result = await processVerifiedWebhook({
      provider: req.params.provider,
      rawBody: req.body,
      headers: req.headers,
      correlationId: req.correlationId,
    });
    res.status(200).json({ received: true, duplicate: result.duplicate, status: result.status });
  } catch (error) {
    const status = error.status || (error.message.includes('configured') ? 503 : 500);
    logger.warn('webhook_rejected', {
      provider: req.params.provider, correlationId: req.correlationId, status, message: error.message,
    });
    res.status(status).json({ error: status >= 500 ? 'Webhook processing failed' : error.message });
  }
}

router.post('/:provider(mtn|airtel|bank)', webhookLimiter, receive);
router.put('/:provider(mtn|airtel|bank)', webhookLimiter, receive);

module.exports = router;
