import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/index.js';
import * as Item from '../models/Item.js';
import * as Location from '../models/Location.js';

const router = Router();

router.use(requireAuth);

// List pending receipts
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT o.*, s.name AS supplier_name,
              COUNT(oi.id) AS line_count
       FROM orders o
       JOIN suppliers s ON o.supplier_id = s.id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.status IN ('submitted', 'confirmed', 'shipped')
       GROUP BY o.id, s.name
       ORDER BY o.expected_delivery_date ASC NULLS LAST`
    );
    res.render('receiving/index', { title: 'Receiving', orders: result.rows, activePage: 'receiving' });
  } catch (err) {
    console.error('Receiving list error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load receiving', activePage: 'receiving' });
  }
});

// Receive form for an order
router.get('/:order_id', async (req, res) => {
  try {
    const orderResult = await query(
      `SELECT o.*, s.name AS supplier_name
       FROM orders o
       JOIN suppliers s ON o.supplier_id = s.id
       WHERE o.id = $1`,
      [req.params.order_id]
    );
    const order = orderResult.rows[0];
    if (!order) {
      res.flash('error', 'Order not found');
      return res.redirect('/receiving');
    }

    const linesResult = await query(
      `SELECT oi.*, i.name AS item_name, i.part_number, i.current_stock,
              COALESCE(oi.received_quantity, 0) AS received_so_far
       FROM order_items oi
       JOIN items i ON oi.item_id = i.id
       WHERE oi.order_id = $1
       ORDER BY oi.id`,
      [req.params.order_id]
    );

    const locations = await Location.findAll();

    res.render('receiving/form', {
      title: `Receive Order ${order.order_number}`,
      order,
      lines: linesResult.rows,
      locations,
      activePage: 'receiving',
    });
  } catch (err) {
    console.error('Receiving form error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load receiving form', activePage: 'receiving' });
  }
});

// Process receipt
router.post('/:order_id', async (req, res) => {
  try {
    const { lines } = req.body;
    const lineEntries = Object.entries(lines || {});

    for (const [lineId, data] of lineEntries) {
      const receivedQty = parseInt(data.received_quantity, 10) || 0;
      if (receivedQty <= 0) continue;

      // Update order item received quantity
      await query(
        `UPDATE order_items SET received_quantity = COALESCE(received_quantity, 0) + $2
         WHERE id = $1`,
        [lineId, receivedQty]
      );

      // Get the item_id for this line
      const lineResult = await query('SELECT item_id FROM order_items WHERE id = $1', [lineId]);
      if (lineResult.rows[0]) {
        const itemId = lineResult.rows[0].item_id;
        const item = await Item.findById(itemId);
        if (item) {
          await Item.updateStock(itemId, item.current_stock + receivedQty);
        }
      }

      // Log the receipt
      if (data.location_id) {
        await query(
          `INSERT INTO receiving_log (order_id, order_item_id, quantity_received, location_id, received_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [req.params.order_id, lineId, receivedQty, data.location_id, req.authUser.id]
        );
      }
    }

    // Check if all lines are fully received
    const checkResult = await query(
      `SELECT COUNT(*) AS pending
       FROM order_items
       WHERE order_id = $1 AND (received_quantity IS NULL OR received_quantity < quantity)`,
      [req.params.order_id]
    );
    const allReceived = parseInt(checkResult.rows[0].pending, 10) === 0;

    if (allReceived) {
      await query(
        `UPDATE orders SET status = 'received', received_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [req.params.order_id]
      );

      // Reset associated cards back to 'at_location'
      const orderItems = await query(
        'SELECT item_id FROM order_items WHERE order_id = $1',
        [req.params.order_id]
      );
      for (const line of orderItems.rows) {
        await query(
          `UPDATE cards SET status = 'at_location', updated_at = NOW()
           WHERE item_id = $1 AND status IN ('ordered', 'in_transit', 'received')`,
          [line.item_id]
        );
      }
    }

    res.flash('success', allReceived ? 'Order fully received' : 'Receipt recorded');
    res.redirect('/receiving');
  } catch (err) {
    console.error('Receiving process error:', err);
    res.flash('error', 'Failed to process receipt');
    res.redirect(`/receiving/${req.params.order_id}`);
  }
});

export default router;
