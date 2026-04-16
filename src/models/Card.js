import { query } from '../db/index.js';

const VALID_TRANSITIONS = {
  at_location: ['in_queue'],
  in_queue: ['ordered'],
  ordered: ['in_transit'],
  in_transit: ['received'],
  received: ['at_location'],
};

export async function findAll({ status, item_id, page = 1, limit = 25 } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`c.status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  if (item_id) {
    conditions.push(`c.item_id = $${paramIndex}`);
    params.push(item_id);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query(
    `SELECT COUNT(*) FROM cards c ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const result = await query(
    `SELECT c.*, i.name AS item_name, i.part_number AS part_number,
            l.name AS location_name
     FROM cards c
     LEFT JOIN items i ON c.item_id = i.id
     LEFT JOIN locations l ON c.location_id = l.id
     ${whereClause}
     ORDER BY c.created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return {
    cards: result.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function findById(id) {
  const result = await query(
    `SELECT c.*, i.name AS item_name, i.part_number AS part_number,
            l.name AS location_name
     FROM cards c
     LEFT JOIN items i ON c.item_id = i.id
     LEFT JOIN locations l ON c.location_id = l.id
     WHERE c.id = $1`,
    [id]
  );
  return result.rows[0];
}

export async function findByUid(card_uid) {
  const result = await query(
    `SELECT c.*, i.name AS item_name, i.part_number AS part_number,
            l.name AS location_name
     FROM cards c
     LEFT JOIN items i ON c.item_id = i.id
     LEFT JOIN locations l ON c.location_id = l.id
     WHERE c.card_uid = $1`,
    [card_uid]
  );
  return result.rows[0];
}

export async function createForItem(item_id, count, location_id) {
  const maxResult = await query(
    'SELECT COALESCE(MAX(loop_number), 0) AS max_loop FROM cards WHERE item_id = $1',
    [item_id]
  );
  let nextLoop = maxResult.rows[0].max_loop + 1;

  const cards = [];
  for (let i = 0; i < count; i++) {
    const result = await query(
      `INSERT INTO cards (item_id, loop_number, location_id, status)
       VALUES ($1, $2, $3, 'at_location')
       RETURNING *`,
      [item_id, nextLoop + i, location_id]
    );
    cards.push(result.rows[0]);
  }
  return cards;
}

export async function updateStatus(id, newStatus, userId) {
  const card = await findById(id);
  if (!card) {
    throw new Error('Card not found');
  }

  const allowed = VALID_TRANSITIONS[card.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `Invalid status transition: ${card.status} -> ${newStatus}. Allowed: ${(allowed || []).join(', ')}`
    );
  }

  const result = await query(
    `UPDATE cards SET status = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, newStatus]
  );
  return result.rows[0];
}

export async function remove(id) {
  const result = await query('DELETE FROM cards WHERE id = $1 RETURNING *', [id]);
  return result.rows[0];
}

export async function findByItemId(itemId) {
  const result = await query(
    `SELECT c.*, l.name AS location_name
     FROM cards c
     LEFT JOIN locations l ON c.location_id = l.id
     WHERE c.item_id = $1
     ORDER BY c.loop_number`,
    [itemId]
  );
  return result.rows;
}
