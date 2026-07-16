const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

// Award bid (create order)
router.post('/bids/:bidId/award', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { bidId } = req.params;
  const { supplier_id, total_amount, contract_file_path } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify bid belongs to tenant
    const { rows: [bid] } = await client.query(
      'SELECT tenant_id, status FROM bids WHERE id = $1 FOR UPDATE',
      [bidId]
    );
    if (!bid) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bid not found' });
    }
    if (bid.status !== 'open' && bid.status !== 'evaluation') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Bid is not in awardable state' });
    }

    // Verify tenant access
    if (req.user.tenant_id && bid.tenant_id !== req.user.tenant_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden: bid belongs to another tenant' });
    }

    // Update bid status and create order in a single transaction
    await client.query('UPDATE bids SET status = $1 WHERE id = $2', ['awarded', bidId]);
    const { rows: [order] } = await client.query(
      `INSERT INTO orders (bid_id, awarded_supplier_id, total_amount, contract_file_path)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [bidId, supplier_id, total_amount, contract_file_path]
    );

    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error awarding bid:', e);
    res.status(500).json({ error: 'Failed to award bid: ' + e.message });
  } finally {
    client.release();
  }
});

// List all orders (with tenant isolation)
router.get('/orders', authenticate, async (req, res) => {
  if (req.user.role !== 'business_admin' && req.user.role !== 'customer' && req.user.user_type !== 'supplier_user') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    let query, params;
    if (req.user.tenant_id) {
      // Tenant-scoped query
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
               WHERE b.tenant_id = $1
               GROUP BY o.id, s.company_name, t.name, ea.status, ea.amount, ea.funded_at, ea.released_at
               ORDER BY o.created_at DESC`;
      params = [req.user.tenant_id];
    } else if (req.user.user_type === 'supplier_user') {
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
               JOIN supplier_users su ON su.supplier_id = s.id
               LEFT JOIN escrow_accounts ea ON ea.order_id = o.id
               LEFT JOIN digital_signatures ds ON ds.document_type = 'order' AND ds.document_id = o.id
               WHERE su.id = $1
               GROUP BY o.id, s.company_name, t.name, ea.status, ea.amount, ea.funded_at, ea.released_at
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

    // Write audit log entry
    await client.query(
      `INSERT INTO audit_log (actor_id, actor_type, actor_email, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, 'order', $5, $6)`,
      [req.user.user_id, req.user.user_type, req.user.email, 'update_order_status', id, JSON.stringify({ old_status: order.status, new_status: status })]
    );

    await client.query('COMMIT');
    res.json(updatedOrder);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error updating order status:', e);
    res.status(500).json({ error: 'Failed to update order status: ' + e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
