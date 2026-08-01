const { randomUUID } = require('crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function correlationId(req, res, next) {
  const supplied = String(req.get('x-correlation-id') || '');
  req.correlationId = UUID_RE.test(supplied) ? supplied : randomUUID();
  res.set('x-correlation-id', req.correlationId);
  next();
}

module.exports = correlationId;
