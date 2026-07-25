require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { TOKEN_COOKIE } = require('./config/auth');
const { init } = require('./db/init');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(compression());
app.use(cookieParser());

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

app.use(express.json({ limit: '10mb' }));

// Global rate limiter for all API routes
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/api', globalLimiter);

app.use('/api/health', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/registration'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/supplier'));
app.use('/api', require('./routes/bid'));

app.use('/api', require('./routes/procurementRequest'));
app.use('/api', require('./routes/order'));
app.use('/api', require('./routes/payment'));
app.use('/api', require('./routes/escrow'));
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

// Start background schedulers (only in server process, not during migrations)
if (process.env.NODE_ENV !== 'migration') {
  try {
    require('./services/bidScheduler');
    require('./services/notificationScheduler');
  } catch (err) {
    console.error('Failed to start background schedulers:', err);
  }
}

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
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

// Initialize database (update admin passwords, chart of accounts) before starting server
init().then(() => {
  app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;
