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
const { validatePassword } = require('../utils/passwordValidation');
const { cleanText } = require('../utils/requestValidation');
const { sendPasswordReset, sendWelcome } = require('../services/emailService');
const {
  assertIdentityEmailAvailable,
  normalizeIdentityEmail,
  requireValidIdentityEmail,
} = require('../services/identityEmailGuard');
const router = express.Router();

function sendWelcomeSafely(email, fullName) {
  const logFailure = error => {
    console.error('Welcome email could not be sent:', error.message);
  };
  try {
    Promise.resolve(sendWelcome(email, fullName)).catch(logFailure);
  } catch (error) {
    logFailure(error);
  }
}

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

// Mandatory document types for Zambian suppliers
const MANDATORY_DOCUMENT_TYPES = [
  'pacra_certificate',
  'zra_tpin',
  'zra_tax_clearance',
  'business_license',
];

// ─── Self-service customer / supplier registration ──────────────────────────
router.post('/register', async (req, res) => {
  const { password, account_type } = req.body;

  let email;
  let fullName;
  let organization;
  let registrationNumber;
  try {
    email = requireValidIdentityEmail(req.body.email);
    fullName = cleanText(req.body.full_name, { required: true, maxLength: 150 });
    organization = cleanText(req.body.organization, { required: true, maxLength: 255 });
    registrationNumber = cleanText(req.body.registration_number, { maxLength: 100 }) || null;
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  if (!['customer', 'supplier'].includes(account_type)) {
    return res.status(400).json({ error: 'Account type must be customer or supplier' });
  }
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  let client;
  let committed = false;
  let account;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    await assertIdentityEmailAvailable(client, email);

    const passwordHash = await bcrypt.hash(password, 12);
    if (account_type === 'customer') {
      const tenantId = crypto.randomUUID();
      await client.query(
        `INSERT INTO tenants (id, name, registration_number)
         VALUES ($1, $2, $3)`,
        [tenantId, organization, registrationNumber]
      );
      const { rows: [user] } = await client.query(
        `INSERT INTO tenant_users (id, tenant_id, email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4, $5, 'customer')
         RETURNING id, email, full_name, role`,
        [crypto.randomUUID(), tenantId, email, passwordHash, fullName]
      );
      account = { ...user, account_type, tenant_id: tenantId };
    } else {
      const supplierId = crypto.randomUUID();
      await client.query(
        `INSERT INTO suppliers
           (id, company_name, registration_number, verification_status, is_active)
         VALUES ($1, $2, $3, 'pending', false)`,
        [supplierId, organization, registrationNumber]
      );
      const { rows: [user] } = await client.query(
        `INSERT INTO supplier_users (id, supplier_id, email, password_hash, full_name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, full_name`,
        [crypto.randomUUID(), supplierId, email, passwordHash, fullName]
      );
      account = { ...user, account_type, supplier_id: supplierId, supplier_status: 'pending' };
    }

    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    if (!committed && client) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be unavailable */ }
    }
    if (error.statusCode === 409) {
      return res.status(409).json({ error: error.message });
    }
    if (error.code === '23505') {
      return res.status(409).json({
        error: registrationNumber
          ? 'An account or organization with these registration details already exists'
          : 'An account with these details already exists',
      });
    }
    console.error('Self-service registration error:', error);
    return res.status(500).json({ error: 'Registration could not be completed' });
  } finally {
    client?.release();
  }

  sendWelcomeSafely(email, fullName);
  return res.status(201).json({
    message: account_type === 'customer'
      ? 'Customer account created successfully'
      : 'Supplier account created. Complete verification to participate in bids.',
    ...account,
  });
});

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
  let email;
  const { password, full_name, company_name, registration_number, business_category } = req.body;
  try {
    email = requireValidIdentityEmail(req.body.email);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  
  // Validate required fields
  if (!email || !password || !full_name || !company_name || !business_category) {
    return res.status(400).json({ error: 'Email, password, full name, company name, and business category are required' });
  }
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  // Check if all mandatory documents are uploaded
  const uploadedDocs = req.files || {};
  const missingRequired = MANDATORY_DOCUMENT_TYPES.filter(
    docType => !uploadedDocs[docType]
  );
  
  if (missingRequired.length > 0) {
    return res.status(400).json({ 
      error: `Missing required documents: ${missingRequired.join(', ')}` 
    });
  }

  let client;
  let committed = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await assertIdentityEmailAvailable(client, email);

    const hash = await bcrypt.hash(password, 12);
    const supplierId = crypto.randomUUID();

    // Create supplier with documents_submitted status
    const { rows: [supplier] } = await client.query(
      `INSERT INTO suppliers (id, company_name, registration_number, business_category, verification_status, is_active, verification_method)
       VALUES ($1, $2, $3, $4, 'documents_submitted', false, 'manual')
       RETURNING id, company_name, verification_status`,
      [supplierId, company_name, registration_number || null, business_category]
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
         VALUES ($1, $2, $3, $4)`,
        [supplierId, docType, file.path, MANDATORY_DOCUMENT_TYPES.includes(docType) ? 'required' : 'optional']
      );
    }

    await client.query('COMMIT');
    committed = true;
    sendWelcomeSafely(email, full_name);
    
    res.status(201).json({
      message: 'Supplier account created with documents. Business Admin will review and verify.',
      email: supplierUser.email,
      full_name: supplierUser.full_name,
      supplier_status: supplier.verification_status,
      documents_uploaded: Object.keys(uploadedDocs).length,
    });
  } catch (e) {
    if (!committed && client) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be unavailable */ }
    }
    if (e.statusCode === 409) {
      return res.status(409).json({ error: e.message });
    }
    if (e.code === '23505') {
      return res.status(409).json({ error: 'An account with this email or registration number already exists' });
    }
    console.error('Supplier registration error:', e);
    res.status(500).json({ error: 'Supplier registration could not be completed' });
  } finally {
    client?.release();
  }
});

// ─── Forgot Password ─────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  const email = normalizeIdentityEmail(req.body.email);
  if (!email) return res.status(400).json({ error: 'Email required' });
  const genericResponse = () => res.json({
    message: 'If the email exists, a reset link has been sent.',
  });

  try {
    // Find user across all tables
    const { rows: users } = await pool.query(
      `SELECT id, 'platform_admin' AS ut FROM platform_admins WHERE LOWER(BTRIM(email))=$1 AND is_active=true
       UNION ALL SELECT id, 'tenant_user' AS ut FROM tenant_users WHERE LOWER(BTRIM(email))=$1 AND is_active=true
       UNION ALL SELECT id, 'supplier_user' AS ut FROM supplier_users WHERE LOWER(BTRIM(email))=$1 AND is_active=true`,
      [email]
    );
    if (users.length !== 1) {
      if (users.length > 1) {
        console.error('Ambiguous normalized identity detected during password reset', {
          matches: users.length,
        });
      }
      // Do not reveal absence or legacy ambiguity, and never select one of
      // several identities for a credential-changing operation.
      return genericResponse();
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

    try {
      await sendPasswordReset(email, token);
    } catch (deliveryError) {
      console.error('Password reset email could not be sent:', deliveryError.message);
    }
    return genericResponse();
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

// ─── Accept Invitation ──────────────────────────────────────────────────────────
router.post('/accept-invitation', async (req, res) => {
  const { password } = req.body;
  if (!req.body.token || !password || !req.body.full_name) {
    return res.status(400).json({ error: 'Token, password, and full name are required' });
  }

  let token;
  let fullName;
  let companyName;
  try {
    token = cleanText(req.body.token, { required: true, maxLength: 128 });
    fullName = cleanText(req.body.full_name, { required: true, maxLength: 150 });
    companyName = cleanText(req.body.company_name, { maxLength: 255 });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    
    // Find invitation
    const { rows: [invitation] } = await client.query(
      `SELECT * FROM invitations WHERE token=$1 AND expires_at > NOW() AND accepted=false FOR UPDATE`,
      [token]
    );
    if (!invitation) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'Invalid or expired invitation token' });
    }

    const email = await assertIdentityEmailAvailable(client, invitation.email);
    const hash = await bcrypt.hash(password, 12);
    
    if (invitation.role === 'supplier') {
      if (!companyName) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(400).json({ error: 'Company name is required for supplier accounts' });
      }
      const supplierId = crypto.randomUUID();
      await client.query(
        `INSERT INTO suppliers (id, company_name, verification_status, is_active, verification_method)
         VALUES ($1, $2, 'verified', true, 'manual')`,
        [supplierId, companyName]
      );
      await client.query(
        `INSERT INTO supplier_users (id, supplier_id, email, password_hash, full_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), supplierId, email, hash, fullName]
      );
    } else if (invitation.role === 'customer') {
      await client.query(
        `INSERT INTO tenant_users (id, tenant_id, email, password_hash, full_name, role)
         VALUES ($1, (SELECT id FROM tenants LIMIT 1), $2, $3, $4, 'customer')`,
        [crypto.randomUUID(), email, hash, fullName]
      );
    } else {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'Unknown role in invitation' });
    }

    // Mark as accepted
    await client.query(
      `UPDATE invitations SET accepted=true WHERE id=$1`,
      [invitation.id]
    );

    await client.query('COMMIT');
    transactionStarted = false;
    res.json({ message: 'Account created successfully. You can now log in.' });
  } catch (e) {
    if (transactionStarted && client) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be unavailable */ }
    }
    if (e.statusCode === 409 || e.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    console.error('Accept invitation error:', e);
    res.status(500).json({ error: 'Failed to accept invitation' });
  } finally {
    client?.release();
  }
});

module.exports = router;
