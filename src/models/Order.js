import { query } from '../db/index.js';

export async function findAll({ status, supplier_id, page = 1, limit = 25 } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`o.status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  if (supplier_id) {
    conditions.push(`o.supplier_id = $${paramIndex}`);
    params.push(supplier_id);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query(
    `SELECT COUNT(*) FROM orders o ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const result = await query(
    `SELECT o.*, s.name AS supplier_name
     FROM orders o
     LEFT JOIN suppliers s ON o.supplier_id = s.id
     ${whereClause}
     ORDER BY o.created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return {
    orders: result.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function findById(id) {
  const orderResult = await query(
    `SELECT o.*, s.name AS supplier_name
     FROM orders o
     LEFT JOIN suppliers s ON o.supplier_id = s.id
     WHERE o.id = $1`,
    [id]
  );
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await query(
    `SELECT oi.*, i.name AS item_name, i.part_number AS item_part_number, c.card_uid
     FROM order_items oi
     LEFT JOIN items i ON oi.item_id = i.id
     LEFT JOIN cards c ON oi.card_id = c.id
     WHERE oi.order_id = $1
     ORDER BY oi.id`,
    [id]
  );
  order.items = itemsResult.rows;

  return order;
}

export async function generateOrderNumber() {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

  const result = await query(
    `SELECT COUNT(*) FROM orders
     WHERE created_at::date = CURRENT_DATE`
  );
  const count = parseInt(result.rows[0].count, 10) + 1;
  const seq = String(count).padStart(4, '0');

  return `PO-${dateStr}-${seq}`;
}

export async function createFromQueue(supplier_id, cardIds, userId) {
  const orderNumber = await generateOrderNumber();

  const orderResult = await query(
    `INSERT INTO orders (order_number, supplier_id, status, created_by)
     VALUES ($1, $2, 'ordered', $3)
     RETURNING *`,
    [orderNumber, supplier_id, userId]
  );
  const order = orderResult.rows[0];

  for (const cardId of cardIds) {
    const cardResult = await query(
      'SELECT * FROM cards WHERE id = $1', [cardId]
    );
    const card = cardResult.rows[0];
    if (!card) continue;

    await query(
      `INSERT INTO order_items (order_id, card_id, item_id)
       VALUES ($1, $2, $3)`,
      [order.id, cardId, card.item_id]
    );

    await query(
      `UPDATE cards SET status = 'ordered', updated_at = NOW()
       WHERE id = $1`,
      [cardId]
    );
  }

  return findById(order.id);
}

export async function updateStatus(id, status) {
  const updates = [`status = $2`, `updated_at = NOW()`];
  const params = [id, status];

  if (status === 'received') {
    updates.push('received_at = NOW()');
  }

  const result = await query(
    `UPDATE orders SET ${updates.join(', ')}
     WHERE id = $1
     RETURNING *`,
    params
  );
  return result.rows[0];
}

export async function getQueue() {
  const result = await query(
    `SELECT
       s.id AS supplier_id,
       s.name AS supplier_name,
       json_agg(
         json_build_object(
           'card_id', c.id,
           'card_uid', c.card_uid,
           'item_id', i.id,
           'item_name', i.name,
           'item_part_number', i.part_number,
           'loop_number', c.loop_number
         ) ORDER BY i.name, c.loop_number
       ) AS cards,
       COUNT(c.id) AS card_count
     FROM cards c
     JOIN items i ON c.item_id = i.id
     JOIN suppliers s ON i.supplier_id = s.id
     WHERE c.status = 'in_queue'
     GROUP BY s.id, s.name
     ORDER BY s.name`
  );
  return result.rows;
}
