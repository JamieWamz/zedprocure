require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { init } = require('./db/init');
const { financialNoStore, requireJsonMutation } = require('./middleware/financialSecurity');
const correlationId = require('./middleware/correlationId');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: false, // allow serving static files cross-origin
}));
app.use(compression());
app.use(cookieParser());
app.use(correlationId);

// Serve static uploads for backward compatibility
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Restrict CORS to known origins so third-party sites cannot call the API from a user's browser.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow non-browser tools (no Origin header) and listed origins.
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Preserve webhook bytes for HMAC verification before the general JSON parser.
app.use('/api/payments/mobile/callback', express.raw({ type: 'application/json', limit: '1mb' }));
app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '2mb' }));

// Global rate limiter for all API routes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  skip: req => req.path.startsWith('/webhooks/'),
});
app.use('/api', globalLimiter);

// Cookie-authenticated mutations must originate from a configured frontend.
// Bearer-token API clients do not carry browser cookies and remain supported.
app.use('/api', (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.originalUrl.startsWith('/api/payments/mobile/callback')) return next();
  if (!req.cookies?.token) return next();
  const origin = req.get('origin');
  if (origin && allowedOrigins.includes(origin)) return next();
  return res.status(403).json({ error: 'Request origin is not trusted' });
});

// Sensitive financial responses must never be cached. Mutations use a single,
// unambiguous JSON parser; the signed webhook raw body is preserved above.
app.use(['/api/payments', '/api/escrow', '/api/wallet', '/api/webhooks'], financialNoStore, requireJsonMutation);

app.use('/api/health', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/registration'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/supplier'));
app.use('/api', require('./routes/bid'));

app.use('/api', require('./routes/procurementRequest'));
app.use('/api', require('./routes/order'));
app.use('/api', require('./routes/payment'));
app.use('/api/webhooks', require('./routes/paymentWebhooks'));
app.use('/api', require('./routes/escrow'));
app.use('/api', require('./routes/payoutAccounts'));
app.use('/api', require('./routes/monetization'));
app.use('/api/ledger', require('./routes/ledger'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/signatures', require('./routes/signatures'));
app.use('/api', require('./routes/supplierList'));
app.use('/api', require('./routes/tenant'));
app.use('/api', require('./routes/system'));
app.use('/api/me', require('./routes/me'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api', require('./routes/dashboard'));
app.use('/api', require('./routes/verification'));
app.use('/api', require('./routes/notifications'));
app.use('/api/support', require('./routes/support'));

// Start background schedulers (only in server process, not during migrations)
if (require.main === module && !['migration', 'test'].includes(process.env.NODE_ENV)) {
  try {
    require('./services/bidScheduler');
    require('./services/notificationScheduler');
    require('./services/escrowReconciliationWorker');
  } catch (err) {
    console.error('Failed to start background schedulers:', err);
  }
}

// SPA Fallback for Render Deployment (serving frontend from backend)
app.get('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/uploads')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../../frontend/build/index.html'));
});

// Global error handler for unhandled promise rejections and errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Give the process time to log before exiting
  setTimeout(() => process.exit(1), 1000);
});

// Express global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : (err.message || 'Request failed') });
});

const PORT = process.env.PORT || 4000;

// Importing the Express app in tests must not bind a port or start long-lived
// workers. `node src/index.js` remains the production entrypoint.
if (require.main === module) {
  init().then(() => {
    app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
  }).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
}

module.exports = app;
