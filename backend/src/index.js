require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('./middleware/authMiddleware');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/supplier'));
app.use('/api', require('./routes/bid'));
app.use('/api', require('./routes/requirement'));
app.use('/api', require('./routes/order'));
app.use('/api', require('./routes/payment'));
app.use('/api', require('./routes/escrow'));
app.use('/api/ledger', require('./routes/ledger'));
app.use('/api', require('./routes/supplierList'));
app.use('/api', require('./routes/tenant'));
app.use('/api', require('./routes/system'));

app.get('/api/me', authenticate, async (req, res) => {
  let route = '/login';
  let tenantId = req.user.tenant_id;  // <-- always take from JWT

  if (req.user.user_type === 'platform_admin' && req.user.role === 'system_admin') route = '/system-health';
  else if (req.user.user_type === 'platform_admin') route = '/admin';
  else if (req.user.user_type === 'tenant_user') {
    if (req.user.role === 'tenant_admin') route = '/admin';
    else route = '/customer';
  } else if (req.user.user_type === 'supplier_user') route = '/supplier';

  res.json({ dashboardRoute: route, tenantId, role: req.user.role });
});
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));