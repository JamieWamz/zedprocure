/**
 * Transactional email service using SMTP (Nodemailer).
 * Falls back to console logging when SMTP is not configured (development).
 */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_PORT) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    console.log('Email service configured for', process.env.SMTP_HOST);
  } else {
    // Dev fallback — log to console
    transporter = {
      sendMail: async (opts) => {
        console.log('\n=== EMAIL (dev fallback) ===');
        console.log(`To: ${opts.to}`);
        console.log(`Subject: ${opts.subject}`);
        console.log(`Body: ${opts.html || opts.text}`);
        console.log('===========================\n');
      },
    };
    console.log('Email service: dev mode (console fallback)');
  }
  return transporter;
}

async function sendMail({ to, subject, html }) {
  const t = getTransporter();
  return t.sendMail({
    from: process.env.SMTP_FROM || 'noreply@zedprocure.gov.zm',
    to,
    subject,
    html,
  });
}

/**
 * Send a password-reset email with a signed token link.
 */
async function sendPasswordReset(email, token) {
  const resetUrl = `${process.env.APP_URL || 'http://localhost'}/reset-password?token=${token}`;
  return sendMail({
    to: email,
    subject: 'Zambia Procurement Portal — Password Reset',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1e3a8a;">Password Reset</h2>
        <p>You requested a password reset for your procurement portal account.</p>
        <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">
          Reset Password
        </a>
        <p style="color: #666; font-size: 12px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}

/**
 * Send a welcome email when a new user registers and sets their own password.
 */
async function sendWelcome(email, fullName) {
  return sendMail({
    to: email,
    subject: 'Welcome to Zambia Procurement Portal',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1e3a8a;">Welcome, ${fullName}!</h2>
        <p>Your account has been created on the Zambia Procurement Portal.</p>
        <p>You can now log in and participate in bids, manage orders, and more.</p>
        <a href="${process.env.APP_URL || 'http://localhost'}/login" style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">
          Sign In
        </a>
      </div>
    `,
  });
}

/**
 * Send an invitation email for user onboarding (admin invites a user).
 */
async function sendInvitation(email, inviteToken, inviterName) {
  const inviteUrl = `${process.env.APP_URL || 'http://localhost'}/accept-invite?token=${inviteToken}`;
  return sendMail({
    to: email,
    subject: 'You\'ve been invited to Zambia Procurement Portal',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1e3a8a;">You're Invited!</h2>
        <p>${inviterName} has invited you to join the Zambia Procurement Portal.</p>
        <p>Click below to set your password and get started.</p>
        <a href="${inviteUrl}" style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">
          Accept Invitation
        </a>
        <p style="color: #666; font-size: 12px;">This invitation expires in 7 days.</p>
      </div>
    `,
  });
}

/**
 * Send a payment confirmation receipt.
 */
async function sendPaymentReceipt(email, fullName, amount, ref, type) {
  return sendMail({
    to: email,
    subject: `Payment Confirmed — ${ref}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1e3a8a;">Payment Receipt</h2>
        <p>Dear ${fullName},</p>
        <p>Your payment has been confirmed:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Reference</strong></td><td>${ref}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Type</strong></td><td>${type}</td></tr>
          <tr><td style="padding: 8px;"><strong>Amount</strong></td><td>ZMW ${parseFloat(amount).toFixed(2)}</td></tr>
        </table>
      </div>
    `,
  });
}

module.exports = {
  sendMail,
  sendPasswordReset,
  sendWelcome,
  sendInvitation,
  sendPaymentReceipt,
};