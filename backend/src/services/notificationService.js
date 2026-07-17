/**
 * Notification Service
 * Handles in-app notification creation and email dispatch for
 * marketplace events: bid published, verification updates, deadline reminders.
 */
const pool = require('../config/db');
const { sendMail } = require('./emailService');

/**
 * Create an in-app notification for a user.
 */
async function createNotification({ userId, userType, type, title, message, link, metadata }) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, user_type, type, title, message, link, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [userId, userType, type, title, message, link, metadata ? JSON.stringify(metadata) : null]
  );
  return rows[0];
}

/**
 * When a global bid is published, notify all VERIFIED suppliers
 * in the same business_category.
 */
async function notifySuppliersOnBidPublished(bid) {
  const { rows: suppliers } = await pool.query(
    `SELECT s.id as supplier_id, su.id as user_id, su.email, su.full_name
     FROM suppliers s
     JOIN supplier_users su ON su.supplier_id = s.id
     WHERE s.verification_status = 'verified'
       AND (s.business_category = $1 OR $1 IS NULL)`,
    [bid.business_category]
  );

  for (const supplier of suppliers) {
    // In-app notification
    await createNotification({
      userId: supplier.user_id,
      userType: 'supplier_user',
      type: 'new_bid',
      title: `New Bid: ${bid.title}`,
      message: `A new bid opportunity has been published${bid.business_category ? ` in ${bid.business_category}` : ''}. Deadline: ${new Date(bid.deadline).toLocaleString()}`,
      link: `/bids/${bid.id}`,
      metadata: { bid_id: bid.id },
    });

    // Email
    await sendMail({
      to: supplier.email,
      subject: `New Bid Opportunity: ${bid.title}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1e3a8a;">New Bid Published</h2>
          <p>Dear ${supplier.full_name},</p>
          <p>A new bid has been published on the Zambia Procurement Portal.</p>
          <p><strong>${bid.title}</strong></p>
          <p>Deadline: ${new Date(bid.deadline).toLocaleString()}</p>
          <a href="${process.env.APP_URL || 'http://localhost'}/bids/${bid.id}"
             style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">
            View Bid Details
          </a>
        </div>
      `,
    });
  }

  return suppliers.length;
}

/**
 * Notify a supplier about a verification decision.
 */
async function notifyVerificationDecision(supplierId, status, notes, adminName) {
  const { rows: [supplier] } = await pool.query(
    'SELECT company_name FROM suppliers WHERE id = $1',
    [supplierId]
  );
  if (!supplier) return 0;

  const { rows: supplierUsers } = await pool.query(
    'SELECT id, email, full_name FROM supplier_users WHERE supplier_id = $1',
    [supplierId]
  );

  for (const user of supplierUsers) {
    const isApproved = status === 'verified';

    await createNotification({
      userId: user.id,
      userType: 'supplier_user',
      type: 'verification_update',
      title: isApproved ? 'Account Verified' : 'Account Rejected',
      message: isApproved
        ? `Your company "${supplier.company_name}" has been verified. You can now bid on open opportunities.`
        : `Your company "${supplier.company_name}" verification was not approved.${notes ? ` Reason: ${notes}` : ' Please contact support.'}`,
      link: '/supplier/verification',
      metadata: { supplier_id: supplierId, status },
    });

    await sendMail({
      to: user.email,
      subject: `Supplier Verification ${isApproved ? 'Approved' : 'Rejected'}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1e3a8a;">Verification ${isApproved ? 'Approved' : 'Rejected'}</h2>
          <p>Dear ${user.full_name},</p>
          <p>Your company <strong>${supplier.company_name}</strong> has been ${status}.</p>
          ${notes ? `<p>Admin notes: ${notes}</p>` : ''}
          ${isApproved ? '<p>You can now participate in open bids on the portal.</p>' : '<p>Please review the requirements and re-submit your documents.</p>'}
          <a href="${process.env.APP_URL || 'http://localhost'}/supplier/verification"
             style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">
            View Status
          </a>
        </div>
      `,
    });
  }

  return supplierUsers.length;
}

module.exports = {
  createNotification,
  notifySuppliersOnBidPublished,
  notifyVerificationDecision,
};
