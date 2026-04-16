import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/index.js';
import * as Card from '../models/Card.js';
import * as ScanHistory from '../models/ScanHistory.js';

const router = Router();

router.use(requireAuth);

// Process scan from scanner JS (JSON API)
router.post('/scan', async (req, res) => {
  try {
    const { card_uid } = req.body;
    if (!card_uid) {
      return res.status(400).json({ error: 'card_uid is required' });
    }

    const card = await Card.findByUid(card_uid);
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }

    // Determine action based on current status
    const previousStatus = card.status;
    let newStatus, action, actionLabel, message;

    switch (card.status) {
      case 'at_location':
        newStatus = 'in_queue';
        action = 'pull';
        actionLabel = 'Card Pulled';
        message = 'Card added to order queue.';
        break;
      case 'in_queue':
        newStatus = 'in_queue';
        action = 'pull';
        actionLabel = 'Already in Queue';
        message = 'This card is already in the order queue.';
        break;
      case 'ordered':
      case 'in_transit':
        newStatus = 'received';
        action = 'receive';
        actionLabel = 'Card Received';
        message = 'Item marked as received.';
        break;
      case 'received':
        newStatus = 'at_location';
        action = 'putaway';
        actionLabel = 'Card Reset';
        message = 'Card returned to shelf location.';
        break;
      default:
        return res.status(400).json({ error: `Unknown card status: ${card.status}` });
    }

    // Update card status if changed
    if (newStatus !== previousStatus) {
      await Card.updateStatus(card.id, newStatus, req.authUser.id);
    }

    // Record scan history
    await ScanHistory.create({
      card_id: card.id,
      scanned_by: req.authUser.id,
      action,
      previous_status: previousStatus,
      new_status: newStatus,
    });

    // Pull current stock for the consumption UI
    const stockResult = await query(
      'SELECT current_stock, unit_of_measure FROM items WHERE id = $1',
      [card.item_id]
    );
    const stock = stockResult.rows[0] || {};

    res.json({
      action_label: actionLabel,
      message,
      card: { id: card.id, card_uid: card.card_uid, status: newStatus },
      item: {
        id: card.item_id,
        part_number: card.part_number,
        name: card.item_name,
        current_stock: stock.current_stock,
        unit_of_measure: stock.unit_of_measure,
      },
    });
  } catch (err) {
    console.error('API scan error:', err);
    res.status(500).json({ error: 'Failed to process scan' });
  }
});

// Record consumption (remove stock from an item)
router.post('/consume', async (req, res) => {
  try {
    const { item_id, quantity } = req.body;
    const qty = parseInt(quantity, 10);
    if (!item_id || !qty || qty <= 0) {
      return res.status(400).json({ error: 'item_id and positive quantity required' });
    }

    const result = await query(
      `UPDATE items
       SET current_stock = GREATEST(0, current_stock - $2),
           updated_at = NOW()
       WHERE id = $1
       RETURNING current_stock, reorder_point, name, part_number`,
      [item_id, qty]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = result.rows[0];
    const belowReorder = item.current_stock <= item.reorder_point;

    res.json({
      success: true,
      item: {
        id: parseInt(item_id, 10),
        name: item.name,
        part_number: item.part_number,
        current_stock: item.current_stock,
        reorder_point: item.reorder_point,
        below_reorder: belowReorder,
      },
      quantity_removed: qty,
    });
  } catch (err) {
    console.error('API consume error:', err);
    res.status(500).json({ error: 'Failed to record consumption' });
  }
});

// Item typeahead search
router.get('/items/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json([]);
    }
    const result = await query(
      `SELECT id, part_number, name, current_stock
       FROM items
       WHERE is_active = true AND (name ILIKE $1 OR part_number ILIKE $1)
       ORDER BY name
       LIMIT 20`,
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('API search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Dashboard stats for HTMX
router.get('/dashboard/stats', async (req, res) => {
  try {
    const [itemCount, cardCount, openOrders, lowStockCount] = await Promise.all([
      query('SELECT COUNT(*) FROM items WHERE is_active = true'),
      query('SELECT COUNT(*) FROM cards'),
      query("SELECT COUNT(*) FROM orders WHERE status IN ('pending', 'submitted')"),
      query('SELECT COUNT(*) FROM items WHERE current_stock <= reorder_point AND is_active = true'),
    ]);
    res.json({
      items: parseInt(itemCount.rows[0].count, 10),
      cards: parseInt(cardCount.rows[0].count, 10),
      openOrders: parseInt(openOrders.rows[0].count, 10),
      lowStock: parseInt(lowStockCount.rows[0].count, 10),
    });
  } catch (err) {
    console.error('API stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// First-run: promote the first user to admin (only works when no admin exists)
router.post('/setup-admin', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    // Only allow if no admin exists yet
    const adminCheck = await query("SELECT COUNT(*) FROM \"user\" WHERE role = 'admin'");
    if (parseInt(adminCheck.rows[0].count, 10) > 0) {
      return res.status(403).json({ error: 'Admin already exists' });
    }

    await query('UPDATE "user" SET role = $1 WHERE id = $2', ['admin', userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Setup admin error:', err);
    res.status(500).json({ error: 'Failed to set admin' });
  }
});

export default router;
