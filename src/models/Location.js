import { query } from '../db/index.js';

export async function findAll() {
  const result = await query('SELECT * FROM locations ORDER BY name');
  return result.rows;
}

export async function findById(id) {
  const result = await query('SELECT * FROM locations WHERE id = $1', [id]);
  return result.rows[0];
}

export async function findByType(type) {
  const result = await query(
    'SELECT * FROM locations WHERE type = $1 ORDER BY name',
    [type]
  );
  return result.rows;
}

export async function getTree() {
  const result = await query(
    'SELECT * FROM locations ORDER BY name'
  );
  const rows = result.rows;

  // Build nested tree from flat list
  const map = {};
  const roots = [];
  for (const row of rows) {
    map[row.id] = { ...row, children: [] };
  }
  for (const row of rows) {
    if (row.parent_id && map[row.parent_id]) {
      map[row.parent_id].children.push(map[row.id]);
    } else {
      roots.push(map[row.id]);
    }
  }
  return roots;
}

export async function create({ name, type, parent_id, description }) {
  const result = await query(
    `INSERT INTO locations (name, type, parent_id, description)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [name, type, parent_id || null, description]
  );
  return result.rows[0];
}

export async function update(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return findById(id);

  const setClauses = keys.map((key, i) => `${key} = $${i + 2}`);
  const values = keys.map((key) => fields[key]);

  const result = await query(
    `UPDATE locations SET ${setClauses.join(', ')}
     WHERE id = $1
     RETURNING *`,
    [id, ...values]
  );
  return result.rows[0];
}

export async function remove(id) {
  const result = await query('DELETE FROM locations WHERE id = $1 RETURNING *', [id]);
  return result.rows[0];
}

export async function getChildren(parentId) {
  const result = await query(
    'SELECT * FROM locations WHERE parent_id = $1 ORDER BY name',
    [parentId]
  );
  return result.rows;
}
