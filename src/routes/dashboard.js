import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/index.js';
import * as Item from '../models/Item.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const [itemCount, cardCount, supplierCount, orderCount, lowStock, recentScans, monthlyOrders] = await Promise.all([
      query('SELECT COUNT(*) FROM items WHERE is_active = true'),
      query('SELECT COUNT(*) FROM cards'),
      query('SELECT COUNT(*) FROM suppliers'),
      query("SELECT COUNT(*) FROM orders WHERE status IN ('pending', 'submitted')"),
      Item.getLowStock(),
      query(
        `SELECT sh.*, c.card_uid, i.name AS item_name, i.part_number
         FROM scan_history sh
         JOIN cards c ON sh.card_id = c.id
         JOIN items i ON c.item_id = i.id
         ORDER BY sh.scanned_at DESC
         LIMIT 10`
      ),
      query(
        `SELECT DATE_TRUNC('month', created_at) AS month,
                COUNT(*) AS count,
                COALESCE(SUM(total_cost), 0) AS total
         FROM orders
         WHERE created_at >= NOW() - INTERVAL '12 months'
         GROUP BY DATE_TRUNC('month', created_at)
         ORDER BY month`
      ),
    ]);

    const stats = {
      items: parseInt(itemCount.rows[0].count, 10),
      cards: parseInt(cardCount.rows[0].count, 10),
      suppliers: parseInt(supplierCount.rows[0].count, 10),
      openOrders: parseInt(orderCount.rows[0].count, 10),
    };

    res.render('dashboard/index', {
      title: 'Dashboard',
      stats,
      lowStock,
      recentScans: recentScans.rows,
      monthlyOrders: monthlyOrders.rows,
      activePage: 'dashboard',
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load dashboard', activePage: 'dashboard' });
  }
});

export default router;
