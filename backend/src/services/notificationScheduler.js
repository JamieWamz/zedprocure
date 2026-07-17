/**
 * Notification Scheduler
 * Background cron job that sends deadline reminders to active bidders
 * at T-minus 24 hours and T-minus 1 hour before the bid deadline.
 *
 * Runs every 15 minutes via node-cron.
 */
const cron = require('node-cron');
const pool = require('../config/db');
const { sendMail } = require('./emailService');

async function sendDeadlineReminders() {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in1h = new Date(now.getTime() + 60 * 60 * 1000);

  try {
    // Find active bids where deadline is approaching
    const { rows: approachingBids } = await pool.query(
      `SELECT b.id, b.title, b.deadline
       FROM bids b
       WHERE b.status = 'open'
         AND (
           (b.deadline BETWEEN $1 AND $2)
           OR (b.deadline BETWEEN $3 AND $4)
         )`,
      [now, in24h, now, in1h]
    );

    for (const bid of approachingBids) {
      const hoursUntilDeadline = Math.max(1, Math.round((bid.deadline - now) / (1000 * 60 * 60)));
      const reminderType = hoursUntilDeadline <= 1 ? '1h' : '24h';

      // Find all supplier users who have responded to this bid
      const { rows: bidders } = await pool.query(
        `SELECT DISTINCT su.id as user_id, su.email, su.full_name, su.supplier_id
         FROM supplier_responses sr
         JOIN bid_suppliers bs ON bs.id = sr.bid_supplier_id
         JOIN supplier_users su ON su.supplier_id = bs.supplier_id
         WHERE bs.bid_id = $1`,
        [bid.id]
      );

      for (const bidder of bidders) {
        // Deduplicate: skip if we already sent this reminder type in the last 2 hours
        const { rows: [existing] } = await pool.query(
          `SELECT id FROM notifications
           WHERE user_id = $1 AND type = $2 AND metadata->>'bid_id' = $3
           AND created_at > now() - interval '2 hours'`,
          [bidder.user_id, `deadline_reminder_${reminderType}`, bid.id]
        );
        if (existing) continue;

        // In-app notification
        await pool.query(
          `INSERT INTO notifications (user_id, user_type, type, title, message, link, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [bidder.user_id, 'supplier_user', `deadline_reminder_${reminderType}`,
           `Bid Deadline Approaching: ${bid.title}`,
           `This bid closes in ${hoursUntilDeadline} hour(s). Submit your response before ${new Date(bid.deadline).toLocaleString()}.`,
           `/bids/${bid.id}`,
           JSON.stringify({ bid_id: bid.id })]
        );

        // Email
        await sendMail({
          to: bidder.email,
          subject: `Reminder: "${bid.title}" closes in ${hoursUntilDeadline} hour(s)`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
              <h2 style="color: #dc2626;">Bid Deadline Reminder</h2>
              <p>Dear ${bidder.full_name},</p>
              <p>This is a reminder that the bid <strong>${bid.title}</strong> closes in <strong>${hoursUntilDeadline} hour(s)</strong>.</p>
              <p><strong>Deadline:</strong> ${new Date(bid.deadline).toLocaleString()}</p>
              <a href="${process.env.APP_URL || 'http://localhost'}/bids/${bid.id}"
                 style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">
                Submit Your Response
              </a>
            </div>
          `,
        });
      }
    }
  } catch (err) {
    console.error('[NotificationScheduler] Error sending reminders:', err);
  }
}

// Schedule: run every 15 minutes
cron.schedule('*/15 * * * *', () => {
  sendDeadlineReminders();
});

console.log('[NotificationScheduler] Started — checking for deadline reminders every 15 minutes');

module.exports = { sendDeadlineReminders };
