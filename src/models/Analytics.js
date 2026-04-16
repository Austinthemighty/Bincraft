import { query } from '../db/index.js';

export async function getSummaryStats() {
  const result = await query(
    `SELECT
       (SELECT COUNT(*) FROM items WHERE current_stock <= reorder_point AND is_active = true) AS low_stock_items,
       (SELECT COUNT(*) FROM orders WHERE status IN ('ordered', 'in_transit')) AS pending_orders,
       (SELECT COUNT(*) FROM cards WHERE status = 'in_queue') AS cards_in_queue,
       (SELECT COUNT(*) FROM items WHERE is_active = true) AS total_active_items`
  );
  return result.rows[0];
}

export async function getLeadTimeTrends(days = 90) {
  const result = await query(
    `SELECT
       s.id AS supplier_id,
       s.name AS supplier_name,
       DATE_TRUNC('week', o.received_at) AS week,
       ROUND(AVG(EXTRACT(EPOCH FROM (o.received_at - o.created_at)) / 86400), 1) AS avg_lead_time_days,
       COUNT(*) AS order_count
     FROM orders o
     JOIN suppliers s ON o.supplier_id = s.id
     WHERE o.received_at IS NOT NULL
       AND o.received_at >= NOW() - MAKE_INTERVAL(days => $1)
     GROUP BY s.id, s.name, DATE_TRUNC('week', o.received_at)
     ORDER BY week DESC, s.name`,
    [days]
  );
  return result.rows;
}

export async function getOrderVelocity(months = 6) {
  const result = await query(
    `SELECT
       DATE_TRUNC('week', o.created_at) AS week,
       COUNT(*) AS order_count,
       SUM(
         (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
       ) AS total_items
     FROM orders o
     WHERE o.created_at >= NOW() - MAKE_INTERVAL(months => $1)
     GROUP BY DATE_TRUNC('week', o.created_at)
     ORDER BY week`,
    [months]
  );
  return result.rows;
}

export async function getSupplierReliability() {
  const result = await query(
    `SELECT
       s.id AS supplier_id,
       s.name AS supplier_name,
       COUNT(o.id) AS total_orders,
       COUNT(o.id) FILTER (WHERE o.status = 'received') AS delivered_orders,
       ROUND(
         COUNT(o.id) FILTER (WHERE o.status = 'received' AND o.received_at <= o.expected_delivery_date)::numeric
         / NULLIF(COUNT(o.id) FILTER (WHERE o.status = 'received'), 0) * 100, 1
       ) AS on_time_percentage,
       ROUND(
         AVG(EXTRACT(EPOCH FROM (o.received_at - o.created_at)) / 86400)
         FILTER (WHERE o.received_at IS NOT NULL), 1
       ) AS avg_lead_time_days
     FROM suppliers s
     LEFT JOIN orders o ON o.supplier_id = s.id
     GROUP BY s.id, s.name
     ORDER BY s.name`
  );
  return result.rows;
}

export async function getConsumptionPatterns(itemId, days = 30) {
  const result = await query(
    `SELECT
       DATE_TRUNC('day', sh.scanned_at) AS day,
       COUNT(*) AS scan_count,
       COUNT(*) FILTER (WHERE sh.action = 'pull') AS pull_count,
       COUNT(*) FILTER (WHERE sh.action = 'receive') AS receive_count
     FROM scan_history sh
     JOIN cards c ON sh.card_id = c.id
     WHERE c.item_id = $1
       AND sh.scanned_at >= NOW() - MAKE_INTERVAL(days => $2)
     GROUP BY DATE_TRUNC('day', sh.scanned_at)
     ORDER BY day`,
    [itemId, days]
  );
  return result.rows;
}
