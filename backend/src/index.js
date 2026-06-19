require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const supplierRoutes = require('./routes/supplier');
const bidRoutes = require('./routes/bid');
const requirementRoutes = require('./routes/requirement');
const orderRoutes = require('./routes/order');
const paymentRoutes = require('./routes/payment');
const escrowRoutes = require('./routes/escrow');
const ledgerRoutes = require('./routes/ledger');
const supplierListRoutes = require('./routes/supplierList');
const tenantRoutes = require('./routes/tenant');
const { authenticate } = require('./middleware/authMiddleware');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', supplierRoutes);
app.use('/api', bidRoutes);
app.use('/api', requirementRoutes);
app.use('/api', orderRoutes);
app.use('/api', paymentRoutes);
app.use('/api', escrowRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api', supplierListRoutes);
app.use('/api', tenantRoutes);
app.use('/api', require('./routes/system'));

app.get('/api/me', authenticate, async (req, res) => {
  let route = '/login';
  let tenantId = null;
  if (req.user.user_type === 'platform_admin' && req.user.role === 'system_admin') route = '/system-health';
  else if (req.user.user_type === 'platform_admin') route = '/admin-dashboard';
  else if (req.user.user_type === 'tenant_user') {
    if (req.user.role === 'tenant_admin') route = '/tenant-admin';
    else route = '/customer';
    tenantId = req.user.tenant_id;
  } else if (req.user.user_type === 'supplier_user') route = '/supplier';
  res.json({ dashboardRoute: route, tenantId });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));