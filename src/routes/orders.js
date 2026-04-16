import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/index.js';

const router = Router();

router.use(requireAuth);

// List orders
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT o.*, s.name AS supplier_name,
              COUNT(oi.id) AS line_count
       FROM orders o
       JOIN suppliers s ON o.supplier_id = s.id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       GROUP BY o.id, s.name
       ORDER BY o.created_at DESC`
    );
    res.render('orders/index', { title: 'Orders', orders: result.rows, activePage: 'orders' });
  } catch (err) {
    console.error('Orders list error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load orders', activePage: 'orders' });
  }
});

// Order queue - cards with status 'in_queue' grouped by supplier
router.get('/queue', async (req, res) => {
  try {
    const result = await query(
      `SELECT i.*, s.name AS supplier_name, s.id AS supplier_id,
              c.id AS card_id, c.card_uid, c.status AS card_status
       FROM cards c
       JOIN items i ON c.item_id = i.id
       LEFT JOIN suppliers s ON i.supplier_id = s.id
       WHERE c.status = 'in_queue' AND i.is_active = true
       ORDER BY s.name, i.name`
    );

    // Group by supplier
    const grouped = {};
    for (const row of result.rows) {
      const key = row.supplier_id || 'unassigned';
      if (!grouped[key]) {
        grouped[key] = {
          supplier_id: row.supplier_id,
          supplier_name: row.supplier_name || 'No Supplier',
          items: {},
        };
      }
      if (!grouped[key].items[row.id]) {
        grouped[key].items[row.id] = {
          ...row,
          card_count: 0,
          card_ids: [],
        };
      }
      grouped[key].items[row.id].card_count++;
      grouped[key].items[row.id].card_ids.push(row.card_id);
    }

    res.render('orders/queue', { title: 'Order Queue', grouped, activePage: 'orders' });
  } catch (err) {
    console.error('Order queue error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load order queue', activePage: 'orders' });
  }
});

// Create order from queue
router.post('/', async (req, res) => {
  try {
    const { supplier_id, items } = req.body;
    const lineItems = typeof items === 'string' ? JSON.parse(items) : (items || []);

    if (!supplier_id || lineItems.length === 0) {
      res.flash('error', 'Supplier and at least one item required');
      return res.redirect('/orders/queue');
    }

    const totalCost = lineItems.reduce(
      (sum, li) => sum + (parseFloat(li.quantity) * parseFloat(li.cost_per_unit || 0)),
      0
    );

    // Generate order number
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countResult = await query(
      "SELECT COUNT(*) FROM orders WHERE created_at >= CURRENT_DATE"
    );
    const seq = String(parseInt(countResult.rows[0].count) + 1).padStart(4, '0');
    const orderNumber = `PO-${dateStr}-${seq}`;

    const orderResult = await query(
      `INSERT INTO orders (order_number, supplier_id, status, total_cost, created_by)
       VALUES ($1, $2, 'pending', $3, $4)
       RETURNING *`,
      [orderNumber, supplier_id, totalCost, req.authUser.id]
    );
    const order = orderResult.rows[0];

    for (const li of lineItems) {
      await query(
        `INSERT INTO order_items (order_id, item_id, quantity, unit_cost)
         VALUES ($1, $2, $3, $4)`,
        [order.id, li.item_id, li.quantity, li.cost_per_unit || 0]
      );
      // Transition cards from in_queue to ordered
      if (li.card_ids) {
        const cardIds = typeof li.card_ids === 'string' ? JSON.parse(li.card_ids) : li.card_ids;
        for (const cardId of cardIds) {
          await query(
            `UPDATE cards SET status = 'ordered', updated_at = NOW() WHERE id = $1 AND status = 'in_queue'`,
            [cardId]
          );
        }
      }
    }

    res.flash('success', `Order ${orderNumber} created`);
    res.redirect(`/orders/${order.id}`);
  } catch (err) {
    console.error('Order create error:', err);
    res.flash('error', 'Failed to create order');
    res.redirect('/orders/queue');
  }
});

// Order detail
router.get('/:id', async (req, res) => {
  try {
    const orderResult = await query(
      `SELECT o.*, s.name AS supplier_name, s.email AS supplier_email
       FROM orders o
       JOIN suppliers s ON o.supplier_id = s.id
       WHERE o.id = $1`,
      [req.params.id]
    );
    const order = orderResult.rows[0];
    if (!order) {
      res.flash('error', 'Order not found');
      return res.redirect('/orders');
    }

    const linesResult = await query(
      `SELECT oi.*, i.name AS item_name, i.part_number
       FROM order_items oi
       JOIN items i ON oi.item_id = i.id
       WHERE oi.order_id = $1
       ORDER BY oi.id`,
      [req.params.id]
    );

    res.render('orders/show', {
      title: `Order ${order.order_number}`,
      order,
      lines: linesResult.rows,
      activePage: 'orders',
    });
  } catch (err) {
    console.error('Order show error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load order', activePage: 'orders' });
  }
});

// Update order status
router.put('/:id', async (req, res) => {
  try {
    const { status, expected_delivery_date, notes } = req.body;
    const updates = ['updated_at = NOW()'];
    const params = [req.params.id];
    let idx = 2;

    if (status) {
      updates.push(`status = $${idx++}`);
      params.push(status);
      if (status === 'received') {
        updates.push(`received_at = NOW()`);
      }
    }
    if (expected_delivery_date) {
      updates.push(`expected_delivery_date = $${idx++}`);
      params.push(expected_delivery_date);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      params.push(notes);
    }

    await query(
      `UPDATE orders SET ${updates.join(', ')} WHERE id = $1`,
      params
    );

    res.flash('success', 'Order updated');
    res.redirect(`/orders/${req.params.id}`);
  } catch (err) {
    console.error('Order update error:', err);
    res.flash('error', 'Failed to update order');
    res.redirect(`/orders/${req.params.id}`);
  }
});

// Submit order to supplier
router.post('/:id/submit', async (req, res) => {
  try {
    await query(
      `UPDATE orders SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [req.params.id]
    );
    res.flash('success', 'Order submitted to supplier');
    res.redirect(`/orders/${req.params.id}`);
  } catch (err) {
    console.error('Order submit error:', err);
    res.flash('error', 'Failed to submit order');
    res.redirect(`/orders/${req.params.id}`);
  }
});

export default router;
