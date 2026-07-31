function financialNoStore(_req, res, next) {
  res.set({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
  });
  next();
}

function requireJsonMutation(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Financial mutations require application/json' });
  }
  next();
}

module.exports = { financialNoStore, requireJsonMutation };
