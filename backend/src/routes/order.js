const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const { transitionEscrow } = require('../services/escrowStateMachine');
const router = express.Router();

function projectOrderForUser(order, user) {
  if (user.role === 'business_admin' || user.role === 'system_admin') return order;
  const common = {
    id: order.id,
    bid_id: order.bid_id,
    awarded_supplier_id: order.awarded_supplier_id,
    status: order.status,
    escrow_state: order.escrow_state,
    contract_file_path: order.contract_file_path,
    created_at: order.created_at,
  };
  if (user.user_type === 'supplier_user') {
    return { ...common, total_amount: order.supplier_payout_amount, supplier_payout_amount: order.supplier_payout_amount };
  }
  return {
    ...common,
    total_amount: order.total_amount,
    buyer_price: order.buyer_price,
    buyer_protection_fee: order.buyer_protection_fee,
    express_match_fee: order.express_match_fee,
  };
}

// List all orders (with tenant isolation)
router.get('/orders', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'customer' && req.user.user_type !== 'supplier_user') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    let query, params;
    const customerOrderColumns = `o.id, o.bid_id, o.awarded_supplier_id, o.total_amount,
      o.status, o.escrow_state, o.contract_file_path, o.created_at, o.award_decision_notes, o.awarded_at,
      o.buyer_price, o.buyer_protection_fee, o.express_match_fee`;
    const supplierOrderColumns = `o.id, o.bid_id, o.awarded_supplier_id,
      o.supplier_payout_amount AS total_amount, o.status, o.escrow_state, o.contract_file_path,
      o.created_at, o.award_decision_notes, o.awarded_at, o.supplier_price,
      o.supplier_payout_amount`;
    if (req.user.tenant_id) {
      // Tenant-scoped query
      query = `SELECT ${customerOrderColumns}, s.company_name AS supplier_name, t.name AS tenant_name,
                      COUNT(ds.id)::int AS signature_count,
                      MAX(ds.signed_at) AS last_signed_at,
                      ea.status AS escrow_status,
                      ea.amount AS escrow_amount,
                      ea.funded_at,
                      ea.released_at
               FROM orders o
               JOIN bids b ON b.id = o.bid_id
               JOIN tenants t ON t.id = b.tenant_id
               JOIN suppliers s ON s.id = o.awarded_supplier_id
               LEFT JOIN escrow_accounts ea ON ea.order_id = o.id
               LEFT JOIN digital_signatures ds ON ds.document_type = 'order' AND ds.document_id = o.id
               WHERE b.tenant_id = $1
               GROUP BY o.id, s.company_name, t.name, ea.status, ea.amount, ea.funded_at, ea.released_at
               ORDER BY o.created_at DESC`;
      params = [req.user.tenant_id];
    } else if (req.user.user_type === 'supplier_user') {
      query = `SELECT ${supplierOrderColumns}, s.company_name AS supplier_name, t.name AS tenant_name,
                      COUNT(ds.id)::int AS signature_count,
                      MAX(ds.signed_at) AS last_signed_at,
                      ea.status AS escrow_status,
                      ea.supplier_payout_amount AS escrow_amount,
                      ea.funded_at,
                      ea.released_at
               FROM orders o
               JOIN bids b ON b.id = o.bid_id
               JOIN tenants t ON t.id = b.tenant_id
               JOIN suppliers s ON s.id = o.awarded_supplier_id
               JOIN supplier_users su ON su.supplier_id = s.id
               LEFT JOIN escrow_accounts ea ON ea.order_id = o.id
               LEFT JOIN digital_signatures ds ON ds.document_type = 'order' AND ds.document_id = o.id
               WHERE su.id = $1
               GROUP BY o.id, s.company_name, t.name, ea.status, ea.supplier_payout_amount, ea.funded_at, ea.released_at
               ORDER BY o.created_at DESC`;
      params = [req.user.user_id];
    } else {
      // Business admin sees all
      query = `SELECT o.*, s.company_name AS supplier_name, t.name AS tenant_name,
                      COUNT(ds.id)::int AS signature_count,
                      MAX(ds.signed_at) AS last_signed_at,
                      ea.status AS escrow_status,
                      ea.amount AS escrow_amount,
                      ea.funded_at,
                      ea.released_at
               FROM orders o
               JOIN bids b ON b.id = o.bid_id
               JOIN tenants t ON t.id = b.tenant_id
               JOIN suppliers s ON s.id = o.awarded_supplier_id
               LEFT JOIN escrow_accounts ea ON ea.order_id = o.id
               LEFT JOIN digital_signatures ds ON ds.document_type = 'order' AND ds.document_id = o.id
               GROUP BY o.id, s.company_name, t.name, ea.status, ea.amount, ea.funded_at, ea.released_at
               ORDER BY o.created_at DESC`;
      params = [];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    console.error('Error fetching orders:', e);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Update order status (accept, start delivery, mark delivered, complete, dispute)
router.patch('/orders/:id/status', authenticate, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['accepted', 'delivery_in_progress', 'delivered', 'completed', 'disputed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid target status' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [order] } = await client.query(
      `SELECT o.*, b.tenant_id
       FROM orders o
       JOIN bids b ON b.id = o.bid_id
       WHERE o.id = $1 FOR UPDATE`,
      [id]
    );

    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    if (req.user.user_type === 'supplier_user') {
      // Find supplier_id for the current supplier user
      const { rows: [supplierUser] } = await client.query(
        'SELECT supplier_id FROM supplier_users WHERE id = $1',
        [req.user.user_id]
      );
      if (!supplierUser || order.awarded_supplier_id !== supplierUser.supplier_id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Forbidden: You are not the awarded supplier for this order' });
      }

      // Check transitions
      if (status === 'accepted' && order.status !== 'pending_acceptance') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Can only accept orders that are pending acceptance' });
      }
      if (status === 'delivery_in_progress' && order.status !== 'accepted') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Can only start delivery for accepted orders' });
      }
      if (status === 'delivered' && order.status !== 'delivery_in_progress') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Can only mark as delivered when delivery is in progress' });
      }
      if (!['accepted', 'delivery_in_progress', 'delivered'].includes(status)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Forbidden: Suppliers cannot transition order to ' + status });
      }
    } else if (req.user.user_type === 'tenant_user' && req.user.role === 'customer') {
      if (order.tenant_id !== req.user.tenant_id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Forbidden: Order belongs to another tenant' });
      }

      if (status === 'completed' && !['delivered', 'delivery_in_progress'].includes(order.status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Can only complete orders that are delivered or in progress' });
      }
      if (status === 'disputed' && ['completed', 'pending_acceptance'].includes(order.status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot dispute completed or unaccepted orders' });
      }
      if (!['completed', 'disputed'].includes(status)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Forbidden: Customers cannot transition order to ' + status });
      }
    } else if (req.user.role === 'business_admin' || req.user.role === 'system_admin') {
      // Admins can complete or dispute any order
      if (status === 'completed' && !['delivered', 'delivery_in_progress'].includes(order.status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Can only complete orders that are delivered or in progress' });
      }
    } else {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { rows: [updatedOrder] } = await client.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );

    // The order and escrow dispute states move atomically so no payout can
    // slip through between the commercial dispute and the financial hold.
    if (status === 'disputed') {
      const { rows: [escrow] } = await client.query(
        `SELECT * FROM escrow_transactions WHERE order_id=$1
         AND status IN ('HELD_IN_ESCROW','DISBURSEMENT_PENDING') FOR UPDATE`, [id]
      );
      if (escrow) {
        await transitionEscrow(client, escrow, 'DISPUTED', {
          actorId: req.user.user_id,
          actorType: req.user.user_type,
          correlationId: req.correlationId,
          reason: 'Order dispute opened',
        });
      }
    }

    // Write audit log entry
    await client.query(
      `INSERT INTO audit_log (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, 'order', $5, $6)`,
      [req.user.user_id, req.user.user_type, req.user.email, 'update_order_status', id, JSON.stringify({ old_status: order.status, new_status: status })]
    );

    await client.query('COMMIT');
    res.json(projectOrderForUser(updatedOrder, req.user));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error updating order status:', e);
    res.status(500).json({ error: 'Failed to update order status: ' + e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
