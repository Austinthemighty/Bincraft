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
              i.location_id AS item_location_id,
              i.order_unit, i.pack_size,
              l.name AS item_location_name,
              COALESCE(oi.received_quantity, 0) AS received_so_far
       FROM order_items oi
       JOIN items i ON oi.item_id = i.id
       LEFT JOIN locations l ON i.location_id = l.id
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

    // Diagnostic: if the nested body parser failed, `lines` will be undefined
    if (!lines || typeof lines !== 'object') {
      console.error('[Receiving] req.body.lines missing — body:', JSON.stringify(req.body).slice(0, 500));
      res.flash('error', 'Form data did not reach the server. Try reloading the page.');
      return res.redirect(`/receiving/${req.params.order_id}`);
    }

    const allEntries = Object.entries(lines);
    const lineEntries = allEntries.filter(([_, d]) => parseInt(d?.received_quantity, 10) > 0);

    if (lineEntries.length === 0) {
      const msg = allEntries.length > 0
        ? `No quantities to receive — all ${allEntries.length} line(s) had zero. Enter a positive quantity and try again.`
        : 'No line items submitted.';
      res.flash('warning', msg);
      return res.redirect(`/receiving/${req.params.order_id}`);
    }

    // Form keys use "line_<id>" prefix to prevent the body parser from treating
    // numeric keys as array indices. Strip the prefix to get the real line ID.
    const normalizedEntries = lineEntries.map(([key, data]) => {
      const m = String(key).match(/^line_(\d+)$/);
      const id = m ? parseInt(m[1], 10) : parseInt(key, 10);
      return [id, data];
    }).filter(([id]) => Number.isFinite(id) && id > 0);

    const lineIds = normalizedEntries.map(([id]) => id);
    if (lineIds.length === 0) {
      res.flash('error', 'Could not parse line IDs from form');
      return res.redirect(`/receiving/${req.params.order_id}`);
    }

    const itemsResult = await query(
      `SELECT oi.id AS line_id, oi.item_id, i.order_unit, i.pack_size
       FROM order_items oi
       JOIN items i ON oi.item_id = i.id
       WHERE oi.id = ANY($1) AND oi.order_id = $2`,
      [lineIds, parseInt(req.params.order_id, 10)]
    );

    const lineMeta = {};
    for (const row of itemsResult.rows) {
      lineMeta[row.line_id] = row;
    }

    let processedCount = 0;
    const skippedIds = [];

    for (const [lineId, data] of normalizedEntries) {
      const receivedQty = parseInt(data.received_quantity, 10);
      const meta = lineMeta[lineId];
      if (!meta) {
        skippedIds.push(lineId);
        continue;
      }

      const multiplier = meta.order_unit === 'pack' ? (meta.pack_size || 1) : 1;
      const stockIncrement = receivedQty * multiplier;

      await Promise.all([
        query(
          `UPDATE order_items SET received_quantity = COALESCE(received_quantity, 0) + $2 WHERE id = $1`,
          [parseInt(lineId, 10), receivedQty]
        ),
        query(
          `UPDATE items SET current_stock = current_stock + $2, updated_at = NOW() WHERE id = $1`,
          [meta.item_id, stockIncrement]
        ),
        data.location_id
          ? query(
              `INSERT INTO receiving_log (order_id, order_item_id, quantity_received, location_id, received_by)
               VALUES ($1, $2, $3, $4, $5)`,
              [parseInt(req.params.order_id, 10), parseInt(lineId, 10), receivedQty, parseInt(data.location_id, 10), req.authUser.id]
            )
          : Promise.resolve(),
      ]);
      processedCount++;
    }

    if (processedCount === 0) {
      console.error('[Receiving] No lines processed. Submitted:', lineEntries.map(([id]) => id), 'Matched in DB:', Object.keys(lineMeta), 'Skipped:', skippedIds);
      res.flash('error', `Could not match submitted line IDs to this order. Submitted: [${skippedIds.join(', ')}]. Check that the lines belong to order #${req.params.order_id}.`);
      return res.redirect(`/receiving/${req.params.order_id}`);
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

    const msgParts = [`Received ${processedCount} line${processedCount === 1 ? '' : 's'}`];
    if (allReceived) msgParts.push('Order fully received — stock updated and cards reset');
    res.flash('success', msgParts.join(' · '));
    res.redirect('/receiving');
  } catch (err) {
    console.error('Receiving process error:', err);
    res.flash('error', 'Failed to process receipt');
    res.redirect(`/receiving/${req.params.order_id}`);
  }
});

export default router;
