import { query } from '../db/index.js';

export async function findAll(search) {
  if (search) {
    const result = await query(
      `SELECT * FROM suppliers
       WHERE name ILIKE $1 OR contact_name ILIKE $1
       ORDER BY name`,
      [`%${search}%`]
    );
    return result.rows;
  }
  const result = await query('SELECT * FROM suppliers ORDER BY name');
  return result.rows;
}

export async function findById(id) {
  const result = await query('SELECT * FROM suppliers WHERE id = $1', [id]);
  return result.rows[0];
}

export async function create({ name, contact_name, email, phone, address, notes }) {
  const result = await query(
    `INSERT INTO suppliers (name, contact_name, email, phone, address, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, contact_name, email, phone, address, notes]
  );
  return result.rows[0];
}

export async function update(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return findById(id);

  const setClauses = keys.map((key, i) => `${key} = $${i + 2}`);
  const values = keys.map((key) => fields[key]);

  const result = await query(
    `UPDATE suppliers SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, ...values]
  );
  return result.rows[0];
}

export async function remove(id) {
  const result = await query('DELETE FROM suppliers WHERE id = $1 RETURNING *', [id]);
  return result.rows[0];
}

export async function getStats(id) {
  const result = await query(
    `SELECT
       s.id,
       s.name,
       COUNT(o.id) AS total_orders,
       COUNT(o.id) FILTER (WHERE o.status = 'received') AS received_orders,
       COUNT(o.id) FILTER (WHERE o.status = 'received' AND o.received_at <= o.expected_delivery_date) AS on_time_orders,
       ROUND(
         AVG(EXTRACT(EPOCH FROM (o.received_at - o.created_at)) / 86400)
         FILTER (WHERE o.received_at IS NOT NULL), 1
       ) AS avg_lead_time_days,
       CASE
         WHEN COUNT(o.id) FILTER (WHERE o.status = 'received') > 0
         THEN ROUND(
           COUNT(o.id) FILTER (WHERE o.status = 'received' AND o.received_at <= o.expected_delivery_date)::numeric
           / COUNT(o.id) FILTER (WHERE o.status = 'received') * 100, 1
         )
         ELSE NULL
       END AS on_time_percentage
     FROM suppliers s
     LEFT JOIN orders o ON o.supplier_id = s.id
     WHERE s.id = $1
     GROUP BY s.id, s.name`,
    [id]
  );
  return result.rows[0];
}
