module.exports = function stripBudgetForSupplier(req, res, next) {
  if (req.user && req.user.user_type === 'supplier_user' && req.path.includes('/bids')) {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      if (body && body.requirements) {
        if (Array.isArray(body.requirements)) {
          body.requirements = body.requirements.map(r => {
            const { budget_amount, ...rest } = r;
            return rest;
          });
        } else {
          const { budget_amount, ...rest } = body.requirements;
          body.requirements = rest;
        }
      }
      return originalJson(body);
    };
  }
  next();
};
