/**
 * Bid Scheduler
 * Background cron job that automatically transitions bids from 'open' to 'closed'
 * the moment current_time >= bid_deadline.
 *
 * Runs every minute via node-cron.
 */
const cron = require('node-cron');
const pool = require('../config/db');

async function closeExpiredBids() {
  const client = await pool.connect();
  try {
    const { rows: closed } = await client.query(
      `UPDATE bids SET status = 'closed'
       WHERE status = 'open' AND deadline <= now()
       RETURNING id, title, deadline`
    );

    for (const bid of closed) {
      await client.query(
        `INSERT INTO system_logs (action, entity_type, entity_id, metadata)
         VALUES ($1, $2, $3, $4)`,
        ['bid_auto_closed', 'bid', bid.id,
         JSON.stringify({ title: bid.title, deadline: bid.deadline })]
      );
    }

    if (closed.length > 0) {
      console.log(`[BidScheduler] Closed ${closed.length} expired bid(s)`);
    }
  } catch (err) {
    console.error('[BidScheduler] Error closing expired bids:', err);
  } finally {
    client.release();
  }
}

// Schedule: run every minute
cron.schedule('* * * * *', () => {
  closeExpiredBids();
});

console.log('[BidScheduler] Started — checking for expired bids every minute');

module.exports = { closeExpiredBids };
