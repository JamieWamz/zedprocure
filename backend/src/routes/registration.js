/**
 * Self-service registration, password reset, and invitation acceptance.
 * Users set their own passwords — seed.js is no longer needed for ongoing use.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { validatePassword } = require('../utils/validation');
const { sendPasswordReset, sendWelcome, sendInvitation } = require('../services/emailService');
const router = express.Router();

// Configure multer for document uploads during registration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    crypto.randomBytes(16, (err, buf) => {
      if (err) return cb(err);
      cb(null, `reg-doc-${buf.toString('hex')}${ext}`);
    });
  }
});

const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
const ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
];

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.includes(ext) && ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, DOC, DOCX, JPG, PNG'));
    }
  }
});

// Required document types for Zambian suppliers
const REQUIRED_DOCUMENT_TYPES = [
  'pacra_certificate',
  'zra_tpin',
  'zra_tax_clearance',
  'business_license',
  'directors_id',
  'bank_reference'
];

// ─── Get Required Document Types ─────────────────────────────────────────────
router.get('/required-documents', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT document_type, display_name, description FROM required_document_types 
       WHERE is_active = true ORDER BY sort_order`,
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching required documents:', e);
    res.status(500).json({ error: 'Failed to fetch required document types' });
  }
});

// ─── Supplier Registration with Document Upload ───────────────────────────────
// This endpoint handles multipart form data for document uploads
router.post('/register-supplier', upload.fields([
  { name: 'pacra_certificate', maxCount: 1 },
  { name: 'zra_tpin', maxCount: 1 },
  { name: 'zra_tax_clearance', maxCount: 1 },
  { name: 'business_license', maxCount: 1 },
  { name: 'directors_id', maxCount: 1 },
  { name: 'bank_reference', maxCount: 1 }
]), async (req, res) => {
  const { email, password, full_name, company_name, registration_number } = req.body;
  
  // Validate required fields
  if (!email || !password || !full_name || !company_name) {
    return res.status(400).json({ error: 'Email, password, full name, and company name are required' });
  }
  
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  // Check if all required documents are uploaded
  const uploadedDocs = req.files || {};
  const missingRequired = REQUIRED_DOCUMENT_TYPES.filter(
    docType => !uploadedDocs[docType]
  );
  
  if (missingRequired.length > 0) {
    return res.status(400).json({ 
      error: `Missing required documents: ${missingRequired.join(', ')}` 
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Check if email already exists
    const { rows: existing } = await client.query(
      `SELECT email FROM (
        SELECT email FROM platform_admins UNION ALL
        SELECT email FROM tenant_users UNION ALL
        SELECT email FROM supplier_users
      ) u WHERE email=$1 LIMIT 1`,
      [email]
    );
    if (existing.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const hash = await bcrypt.hash(password, 12);
    const supplierId = crypto.randomUUID();

    // Create supplier with documents_submitted status
    const { rows: [supplier] } = await client.query(
      `INSERT INTO suppliers (id, company_name, registration_number, verification_status, is_active, verification_method)
       VALUES ($1, $2, $3, 'documents_submitted', false, 'manual')
       RETURNING id, company_name, verification_status`,
      [supplierId, company_name, registration_number || null]
    );

    // Create supplier user
    const { rows: [supplierUser] } = await client.query(
      `INSERT INTO supplier_users (id, supplier_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name`,
      [crypto.randomUUID(), supplier.id, email, hash, full_name]
    );

    // Insert all uploaded documents
    for (const [docType, files] of Object.entries(uploadedDocs)) {
      const file = files[0];
      await client.query(
        `INSERT INTO supplier_documents (supplier_id, document_type, file_path, document_category)
         VALUES ($1, $2, $3, 'required')`,
        [supplierId, docType, file.path]
      );
    }

    await client.query('COMMIT');
    await sendWelcome(email, full_name);
    
    res.status(201).json({
      message: 'Supplier account created with documents. Business Admin will review and verify.',
      email: supplierUser.email,
      full_name: supplierUser.full_name,
      supplier_status: supplier.verification_status,
      documents_uploaded: Object.keys(uploadedDocs).length,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Supplier registration error:', e);
    res.status(500).json({ error: 'Registration failed: ' + e.message });
  } finally {
    client.release();
  }
});

// ─── Self-Registration (customer / supplier) ────────────────────────────────
// Legacy endpoint - kept for customer registration
router.post('/register', async (req, res) => {
  const {
    email, password, full_name, organization, registration_number,
    account_type, company_name,
  } = req.body;
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'Email, password, and full name required' });
  }
  const type = account_type === 'supplier' ? 'supplier' : 'customer';
  if (type === 'supplier' && !company_name && !organization) {
    return res.status(400).json({ error: 'Supplier company name is required' });
  }
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Check if email already exists across all user tables
    const { rows: existing } = await client.query(
      `SELECT email FROM (
        SELECT email FROM platform_admins UNION ALL
        SELECT email FROM tenant_users UNION ALL
        SELECT email FROM supplier_users
      ) u WHERE email=$1 LIMIT 1`,
      [email]
    );
    if (existing.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const hash = await bcrypt.hash(password, 12);

    if (type === 'supplier') {
      // For backward compatibility, create supplier without documents
      // They will need to upload documents via the dashboard
      const { rows: [supplier] } = await client.query(
        `INSERT INTO suppliers (id, company_name, registration_number, verification_status, is_active, verification_method)
         VALUES ($1, $2, $3, 'pending', false, 'manual')
         RETURNING id, company_name, verification_status`,
        [crypto.randomUUID(), company_name || organization, registration_number || null]
      );
      const { rows: [supplierUser] } = await client.query(
        `INSERT INTO supplier_users (id, supplier_id, email, password_hash, full_name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, full_name`,
        [crypto.randomUUID(), supplier.id, email, hash, full_name]
      );
      await client.query('COMMIT');
      await sendWelcome(email, full_name);
      return res.status(201).json({
        message: 'Supplier account created. Please upload required documents via the dashboard for verification.',
        email: supplierUser.email,
        full_name: supplierUser.full_name,
        supplier_status: supplier.verification_status,
      });
    }

    const organizationName = organization || `${full_name} Buyer Account`;
    // Use ON CONFLICT only when registration_number is provided, since NULL != NULL in SQL
    // and the unique constraint won't fire for null values, causing duplicate tenants.
    let tenantRow;
    if (registration_number) {
      const { rows: [t] } = await client.query(
        `INSERT INTO tenants (id, name, registration_number)
         VALUES ($1, $2, $3)
         ON CONFLICT (registration_number) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [crypto.randomUUID(), organizationName, registration_number]
      );
      tenantRow = t;
    } else {
      const { rows: [t] } = await client.query(
        `INSERT INTO tenants (id, name) VALUES ($1, $2) RETURNING id`,
        [crypto.randomUUID(), organizationName]
      );
      tenantRow = t;
    }
    const tenant = tenantRow;

    const { rows: [user] } = await client.query(
      `INSERT INTO tenant_users (id, tenant_id, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, full_name, role`,
      [crypto.randomUUID(), tenant.id, email, hash, full_name, 'customer']
    );

    await client.query('COMMIT');
    await sendWelcome(email, full_name);
    res.status(201).json({ message: 'Account created', email: user.email, full_name: user.full_name });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Registration error:', e);
    res.status(500).json({ error: 'Registration failed: ' + e.message });
  } finally {
    client.release();
  }
});

// ─── Forgot Password ─────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    // Find user across all tables
    const { rows: users } = await pool.query(
      `SELECT id, 'platform_admin' AS ut FROM platform_admins WHERE email=$1 AND is_active=true
       UNION ALL SELECT id, 'tenant_user' AS ut FROM tenant_users WHERE email=$1 AND is_active=true
       UNION ALL SELECT id, 'supplier_user' AS ut FROM supplier_users WHERE email=$1 AND is_active=true`,
      [email]
    );
    if (!users.length) {
      // Don't reveal whether email exists — security best practice
      return res.json({ message: 'If the email exists, a reset link has been sent.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    // Store reset token — using a simple table or the user record
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, user_type, token, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, user_type) DO UPDATE SET token=$3, expires_at=$4, used=false`,
      [users[0].id, users[0].ut, token, expiresAt]
    );

    await sendPasswordReset(email, token);
    res.json({ message: 'If the email exists, a reset link has been sent.' });
  } catch (e) {
    console.error('Forgot password error:', e);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ─── Reset Password ──────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  try {
    const { rows: [reset] } = await pool.query(
      `SELECT * FROM password_reset_tokens
       WHERE token=$1 AND expires_at > NOW() AND used=false
       FOR UPDATE`,
      [token]
    );
    if (!reset) return res.status(400).json({ error: 'Invalid or expired reset token' });

    const hash = await bcrypt.hash(password, 12);
    const tables = {
      platform_admin: 'platform_admins',
      tenant_user: 'tenant_users',
      supplier_user: 'supplier_users',
    };
    const table = tables[reset.user_type];
    if (!table) return res.status(400).json({ error: 'Unknown user type' });

    await pool.query(`UPDATE ${table} SET password_hash=$1 WHERE id=$2`, [hash, reset.user_id]);
    await pool.query(`UPDATE password_reset_tokens SET used=true WHERE id=$1`, [reset.id]);

    res.json({ message: 'Password updated successfully' });
  } catch (e) {
    console.error('Reset password error:', e);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ─── Admin Invitation ────────────────────────────────────────────────────────
router.post('/invite', authenticate, async (req, res) => {
  const validRoles = ['customer', 'supplier_user'];
  const { email, role, tenant_id, supplier_id } = req.body;
  if (!email || !role) return res.status(400).json({ error: 'Email and role required' });
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  try {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 86400000); // 7 days

    await pool.query(
      `INSERT INTO invitations (email, role, tenant_id, supplier_id, token, expires_at, invited_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [email, role, tenant_id || req.user.tenant_id, supplier_id, token, expiresAt, req.user.user_id]
    );

    await sendInvitation(email, token, req.user.full_name || 'An administrator');
    res.status(201).json({ message: 'Invitation sent' });
  } catch (e) {
    console.error('Invitation error:', e);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// ─── Accept Invitation ───────────────────────────────────────────────────────
router.post('/accept-invite', async (req, res) => {
  const { token, password, full_name } = req.body;
  if (!token || !password || !full_name) return res.status(400).json({ error: 'Token, password, and name required' });
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  try {
    const { rows: [invite] } = await pool.query(
      `SELECT * FROM invitations WHERE token=$1 AND expires_at > NOW() AND accepted=false FOR UPDATE`,
      [token]
    );
    if (!invite) return res.status(400).json({ error: 'Invalid or expired invitation' });

    const hash = await bcrypt.hash(password, 12);
    const userId = crypto.randomUUID();

    if (invite.role === 'supplier_user') {
      await pool.query(
        `INSERT INTO supplier_users (id, supplier_id, email, password_hash, full_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, invite.supplier_id, invite.email, hash, full_name]
      );
    } else {
      await pool.query(
        `INSERT INTO tenant_users (id, tenant_id, email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, invite.tenant_id, invite.email, hash, full_name, 'customer']
      );
    }

    await pool.query(`UPDATE invitations SET accepted=true WHERE id=$1`, [invite.id]);
    await sendWelcome(invite.email, full_name);
    res.status(201).json({ message: 'Account created successfully. You can now log in.' });
  } catch (e) {
    console.error('Accept invitation error:', e);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

module.exports = router;
