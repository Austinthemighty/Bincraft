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

    // Coerce incoming values — form data arrives as strings
    const supplierIdInt = parseInt(supplier_id, 10);
    if (!supplierIdInt) {
      res.flash('error', 'Invalid supplier');
      return res.redirect('/orders/queue');
    }

    const normalizedLines = lineItems.map((li) => ({
      item_id: parseInt(li.item_id, 10),
      quantity: parseInt(li.quantity, 10) || 1,
      cost_per_unit: parseFloat(li.cost_per_unit) || 0,
    })).filter((li) => li.item_id);

    if (normalizedLines.length === 0) {
      res.flash('error', 'No valid line items selected');
      return res.redirect('/orders/queue');
    }

    const totalCost = normalizedLines.reduce(
      (sum, li) => sum + (li.quantity * li.cost_per_unit),
      0
    );

    // Generate a unique order number — if a collision happens, bump the sequence
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countResult = await query(
      "SELECT COUNT(*) FROM orders WHERE created_at >= CURRENT_DATE"
    );
    let seq = parseInt(countResult.rows[0].count, 10) + 1;
    let orderNumber = `PO-${dateStr}-${String(seq).padStart(4, '0')}`;

    let orderResult;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        orderResult = await query(
          `INSERT INTO orders (order_number, supplier_id, status, total_cost, created_by)
           VALUES ($1, $2, 'pending', $3, $4)
           RETURNING *`,
          [orderNumber, supplierIdInt, totalCost, req.authUser.id]
        );
        break;
      } catch (err) {
        if (err.code === '23505' && err.constraint === 'orders_order_number_key') {
          seq += 1;
          orderNumber = `PO-${dateStr}-${String(seq).padStart(4, '0')}`;
          continue;
        }
        throw err;
      }
    }
    if (!orderResult) {
      res.flash('error', 'Could not assign a unique order number — try again');
      return res.redirect('/orders/queue');
    }
    const order = orderResult.rows[0];

    for (const li of normalizedLines) {
      // Find an in_queue card for this item to link to the order line (if any)
      const queuedCard = await query(
        `SELECT id FROM cards WHERE item_id = $1 AND status = 'in_queue' ORDER BY loop_number LIMIT 1`,
        [li.item_id]
      );
      const linkedCardId = queuedCard.rows[0]?.id || null;

      await query(
        `INSERT INTO order_items (order_id, item_id, card_id, quantity, unit_cost)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, li.item_id, linkedCardId, li.quantity, li.cost_per_unit]
      );

      // Transition all in_queue cards for this item to ordered
      await query(
        `UPDATE cards SET status = 'ordered', updated_at = NOW()
         WHERE item_id = $1 AND status = 'in_queue'`,
        [li.item_id]
      );
    }

    res.flash('success', `Order ${orderNumber} created`);
    res.redirect(`/orders/${order.id}`);
  } catch (err) {
    console.error('Order create error:', err);
    // Surface a user-friendly hint based on common Postgres error codes
    let hint = 'Failed to create order';
    if (err.code === '23502') hint = 'Missing required field: ' + (err.column || 'unknown');
    else if (err.code === '23503') hint = 'Referenced record not found (supplier or item may have been deleted)';
    else if (err.code === '23505') hint = 'Duplicate order number — retry';
    else if (err.code === '22P02') hint = 'Invalid number format in submitted data';
    else if (err.message) hint = `Failed to create order: ${err.message.slice(0, 140)}`;
    res.flash('error', hint);
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

    // If marked as received via the status dropdown, auto-process all line items:
    //   - fill remaining received_quantity
    //   - add stock
    //   - reset cards to at_location
    //   - log to receiving_log at the item's default location
    if (status === 'received') {
      const linesResult = await query(
        `SELECT oi.id, oi.item_id, oi.quantity, COALESCE(oi.received_quantity, 0) AS received_so_far,
                i.current_stock, i.location_id AS item_location_id,
                i.order_unit, i.pack_size
         FROM order_items oi
         JOIN items i ON oi.item_id = i.id
         WHERE oi.order_id = $1`,
        [req.params.id]
      );

      for (const line of linesResult.rows) {
        const remaining = line.quantity - line.received_so_far;
        if (remaining <= 0) continue;

        await query(
          `UPDATE order_items SET received_quantity = COALESCE(received_quantity, 0) + $2
           WHERE id = $1`,
          [line.id, remaining]
        );

        // If ordered by pack, each unit adds pack_size to stock
        const multiplier = line.order_unit === 'pack' ? (line.pack_size || 1) : 1;
        const stockIncrement = remaining * multiplier;

        await query(
          `UPDATE items SET current_stock = current_stock + $2, updated_at = NOW()
           WHERE id = $1`,
          [line.item_id, stockIncrement]
        );

        if (line.item_location_id) {
          await query(
            `INSERT INTO receiving_log (order_id, order_item_id, quantity_received, location_id, received_by)
             VALUES ($1, $2, $3, $4, $5)`,
            [req.params.id, line.id, remaining, line.item_location_id, req.authUser.id]
          );
        }
      }

      // Reset cards tied to this order back to at_location
      await query(
        `UPDATE cards SET status = 'at_location', updated_at = NOW()
         WHERE item_id IN (SELECT item_id FROM order_items WHERE order_id = $1)
           AND status IN ('ordered', 'in_transit', 'received')`,
        [req.params.id]
      );
    }

    res.flash('success', status === 'received' ? 'Order received and stock updated' : 'Order updated');
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
