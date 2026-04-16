import { query } from '../db/index.js';

export async function findAll({ search, supplier_id, is_active, page = 1, limit = 25 } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (search) {
    conditions.push(`(i.name ILIKE $${paramIndex} OR i.part_number ILIKE $${paramIndex} OR i.description ILIKE $${paramIndex})`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (supplier_id) {
    conditions.push(`i.supplier_id = $${paramIndex}`);
    params.push(supplier_id);
    paramIndex++;
  }

  if (is_active !== undefined) {
    conditions.push(`i.is_active = $${paramIndex}`);
    params.push(is_active);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const countResult = await query(
    `SELECT COUNT(*) FROM items i ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  params.push(limit, offset);
  const result = await query(
    `SELECT i.*, s.name AS supplier_name, l.name AS location_name
     FROM items i
     LEFT JOIN suppliers s ON i.supplier_id = s.id
     LEFT JOIN locations l ON i.location_id = l.id
     ${whereClause}
     ORDER BY i.name
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return {
    items: result.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function findById(id) {
  const result = await query(
    `SELECT i.*, s.name AS supplier_name, l.name AS location_name
     FROM items i
     LEFT JOIN suppliers s ON i.supplier_id = s.id
     LEFT JOIN locations l ON i.location_id = l.id
     WHERE i.id = $1`,
    [id]
  );
  return result.rows[0];
}

export async function create(fields) {
  const keys = Object.keys(fields);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const values = keys.map((key) => fields[key]);

  const result = await query(
    `INSERT INTO items (${keys.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function update(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return findById(id);

  const setClauses = keys.map((key, i) => `${key} = $${i + 2}`);
  const values = keys.map((key) => fields[key]);

  const result = await query(
    `UPDATE items SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, ...values]
  );
  return result.rows[0];
}

export async function deactivate(id) {
  const result = await query(
    `UPDATE items SET is_active = false, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return result.rows[0];
}

export async function getLowStock() {
  const result = await query(
    `SELECT i.*, s.name AS supplier_name, l.name AS location_name
     FROM items i
     LEFT JOIN suppliers s ON i.supplier_id = s.id
     LEFT JOIN locations l ON i.location_id = l.id
     WHERE i.current_stock <= i.reorder_point AND i.is_active = true
     ORDER BY (i.current_stock::float / NULLIF(i.reorder_point, 0)) ASC`
  );
  return result.rows;
}

export async function updateStock(id, quantity) {
  const result = await query(
    `UPDATE items SET current_stock = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, quantity]
  );
  return result.rows[0];
}
