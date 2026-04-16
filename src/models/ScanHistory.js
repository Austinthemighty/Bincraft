import { query } from '../db/index.js';

export async function create({ card_id, scanned_by, action, previous_status, new_status, location_id, notes }) {
  const result = await query(
    `INSERT INTO scan_history (card_id, scanned_by, action, previous_status, new_status, location_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [card_id, scanned_by, action, previous_status, new_status, location_id || null, notes || null]
  );
  return result.rows[0];
}

export async function findByCard(card_id) {
  const result = await query(
    `SELECT sh.*, l.name AS location_name
     FROM scan_history sh
     LEFT JOIN locations l ON sh.location_id = l.id
     WHERE sh.card_id = $1
     ORDER BY sh.created_at DESC`,
    [card_id]
  );
  return result.rows;
}

export async function getRecentScans(limit = 50) {
  const result = await query(
    `SELECT sh.*, c.card_uid, i.name AS item_name, l.name AS location_name
     FROM scan_history sh
     LEFT JOIN cards c ON sh.card_id = c.id
     LEFT JOIN items i ON c.item_id = i.id
     LEFT JOIN locations l ON sh.location_id = l.id
     ORDER BY sh.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}
