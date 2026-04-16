import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/index.js';
import { generateQRDataUrl, generateQRBuffer, getAppUrl, getCardScanUrl } from '../utils/qr.js';

const router = Router();

router.use(requireAuth);

// List cards with filters
router.get('/', async (req, res) => {
  try {
    const { status, item_id } = req.query;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`c.status = $${paramIndex++}`);
      params.push(status);
    }
    if (item_id) {
      conditions.push(`c.item_id = $${paramIndex++}`);
      params.push(item_id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(
      `SELECT c.*, i.name AS item_name, i.part_number
       FROM cards c
       JOIN items i ON c.item_id = i.id
       ${whereClause}
       ORDER BY c.created_at DESC`,
      params
    );
    res.render('cards/index', {
      title: 'Cards',
      cards: result.rows,
      filters: { status: status || '', item_id: item_id || '' },
      activePage: 'cards',
    });
  } catch (err) {
    console.error('Cards list error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load cards', activePage: 'cards' });
  }
});

// Print page for cards
router.get('/print', async (req, res) => {
  try {
    const { ids, item_id, status, format } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    const baseSelect = `SELECT c.*, i.name AS item_name, i.part_number, i.reorder_quantity, i.label_color,
              s.name AS supplier_name, l.name AS location_name
       FROM cards c
       JOIN items i ON c.item_id = i.id
       LEFT JOIN suppliers s ON i.supplier_id = s.id
       LEFT JOIN locations l ON c.location_id = l.id`;

    if (ids) {
      const idList = ids.split(',').map((id) => parseInt(id, 10)).filter(Boolean);
      // Cap at 1000 IDs to prevent abuse / giant queries
      if (idList.length > 1000) idList.length = 1000;
      conditions.push(`c.id = ANY($${idx++})`);
      params.push(idList);
    }
    if (item_id) {
      conditions.push(`c.item_id = $${idx++}`);
      params.push(item_id);
    }
    if (status && ['at_location', 'in_queue', 'ordered', 'in_transit', 'received'].includes(status)) {
      conditions.push(`c.status = $${idx++}`);
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(
      `${baseSelect} ${where} ORDER BY i.part_number, c.loop_number LIMIT 2000`,
      params
    );

    const appUrl = await getAppUrl();
    const cards = await Promise.all(
      result.rows.map(async (card) => {
        const scanUrl = getCardScanUrl(appUrl, card.card_uid);
        const qrDataUrl = card.qr_data_url || await generateQRDataUrl(scanUrl);
        return { ...card, qrDataUrl };
      })
    );

    res.render('cards/print', { title: 'Print Cards', cards, format: format || 'custom', layout: false, activePage: 'cards' });
  } catch (err) {
    console.error('Cards print error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load print view', activePage: 'cards' });
  }
});

// Create cards for an item
router.post('/', async (req, res) => {
  try {
    const { item_id, quantity } = req.body;
    const count = Math.min(parseInt(quantity, 10) || 1, 100);
    const appUrl = await getAppUrl();

    // Get current max loop number
    const maxResult = await query(
      'SELECT COALESCE(MAX(loop_number), 0) AS max_loop FROM cards WHERE item_id = $1',
      [item_id]
    );
    let nextLoop = maxResult.rows[0].max_loop + 1;

    // Get item's location
    const itemResult = await query('SELECT location_id FROM items WHERE id = $1', [item_id]);
    const locationId = itemResult.rows[0]?.location_id || null;

    // Insert all cards first to obtain their generated UUIDs
    const newCards = [];
    for (let i = 0; i < count; i++) {
      const cardResult = await query(
        `INSERT INTO cards (item_id, loop_number, status, location_id)
         VALUES ($1, $2, 'at_location', $3)
         RETURNING id, card_uid`,
        [item_id, nextLoop + i, locationId]
      );
      newCards.push(cardResult.rows[0]);
    }

    // Generate all QR codes in parallel, then write them back in parallel
    const qrDataUrls = await Promise.all(
      newCards.map(c => generateQRDataUrl(getCardScanUrl(appUrl, c.card_uid)))
    );
    await Promise.all(
      newCards.map((c, i) => query(
        'UPDATE cards SET qr_data_url = $1 WHERE id = $2',
        [qrDataUrls[i], c.id]
      ))
    );

    res.flash('success', `Created ${count} card(s)`);
    res.redirect(`/items/${item_id}`);
  } catch (err) {
    console.error('Card create error:', err);
    res.flash('error', 'Failed to create cards');
    res.redirect('/cards');
  }
});

// Card detail with scan history
router.get('/:id', async (req, res) => {
  try {
    const cardResult = await query(
      `SELECT c.*, i.name AS item_name, i.part_number, l.name AS location_name
       FROM cards c
       JOIN items i ON c.item_id = i.id
       LEFT JOIN locations l ON c.location_id = l.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    const card = cardResult.rows[0];
    if (!card) {
      res.flash('error', 'Card not found');
      return res.redirect('/cards');
    }

    const scansResult = await query(
      `SELECT sh.*, u.name AS scanned_by_name
       FROM scan_history sh
       LEFT JOIN "user" u ON sh.scanned_by = u.id
       WHERE sh.card_id = $1
       ORDER BY sh.scanned_at DESC`,
      [req.params.id]
    );

    // Generate QR if not cached
    if (!card.qr_data_url) {
      const appUrl = await getAppUrl();
      const scanUrl = getCardScanUrl(appUrl, card.card_uid);
      card.qr_data_url = await generateQRDataUrl(scanUrl);
      await query('UPDATE cards SET qr_data_url = $1 WHERE id = $2', [card.qr_data_url, card.id]);
    }

    res.render('cards/show', {
      title: `Card ${card.card_uid.substring(0, 8)}...`,
      card,
      scans: scansResult.rows,
      activePage: 'cards',
    });
  } catch (err) {
    console.error('Card show error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load card', activePage: 'cards' });
  }
});

// QR code image endpoint
router.get('/:id/qr', async (req, res) => {
  try {
    const result = await query('SELECT card_uid FROM cards WHERE id = $1', [req.params.id]);
    const card = result.rows[0];
    if (!card) return res.status(404).send('Card not found');

    const appUrl = await getAppUrl();
    const scanUrl = getCardScanUrl(appUrl, card.card_uid);
    const buffer = await generateQRBuffer(scanUrl);
    res.type('png').send(buffer);
  } catch (err) {
    console.error('QR generate error:', err);
    res.status(500).send('Failed to generate QR code');
  }
});

// Delete card
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM cards WHERE id = $1 RETURNING item_id', [req.params.id]);
    res.flash('success', 'Card deleted');
    const itemId = result.rows[0]?.item_id;
    res.redirect(itemId ? `/items/${itemId}` : '/cards');
  } catch (err) {
    console.error('Card delete error:', err);
    res.flash('error', 'Failed to delete card');
    res.redirect('/cards');
  }
});

export default router;
