import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import multer from 'multer';
import * as Item from '../models/Item.js';
import * as Supplier from '../models/Supplier.js';
import * as Location from '../models/Location.js';
import * as Card from '../models/Card.js';
import * as ScanHistory from '../models/ScanHistory.js';
import { parseItemsCsv } from '../utils/csv.js';
import { generateQRDataUrl, getAppUrl, getCardScanUrl } from '../utils/qr.js';
import { query } from '../db/index.js';

// Helper: create a single Kanban card with QR code for an item
async function createCardWithQR(itemId, locationId) {
  const maxResult = await query(
    'SELECT COALESCE(MAX(loop_number), 0) AS max_loop FROM cards WHERE item_id = $1',
    [itemId]
  );
  const nextLoop = maxResult.rows[0].max_loop + 1;

  const cardResult = await query(
    `INSERT INTO cards (item_id, loop_number, status, location_id)
     VALUES ($1, $2, 'at_location', $3)
     RETURNING id, card_uid`,
    [itemId, nextLoop, locationId || null]
  );
  const card = cardResult.rows[0];

  const appUrl = await getAppUrl();
  const scanUrl = getCardScanUrl(appUrl, card.card_uid);
  const qrDataUrl = await generateQRDataUrl(scanUrl);

  await query('UPDATE cards SET qr_data_url = $1 WHERE id = $2', [qrDataUrl, card.id]);
  return card;
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(requireAuth);

// List items
router.get('/', async (req, res) => {
  try {
    const { search, supplier_id, status, page } = req.query;
    // status filter: 'active' (default), 'inactive', or 'all'
    const showStatus = status || 'active';
    const findParams = {
      search,
      supplier_id,
      page: parseInt(page, 10) || 1,
    };
    if (showStatus === 'active') findParams.is_active = true;
    else if (showStatus === 'inactive') findParams.is_active = false;
    // 'all' → omit the filter

    const result = await Item.findAll(findParams);
    const suppliers = await Supplier.findAll();
    res.render('items/index', {
      title: 'Items',
      items: result.items,
      pagination: { page: result.page, totalPages: result.totalPages, total: result.total },
      suppliers,
      filters: { search: search || '', supplier_id: supplier_id || '', status: showStatus },
      activePage: 'items',
    });
  } catch (err) {
    console.error('Items list error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load items', activePage: 'items' });
  }
});

// New item form
router.get('/new', async (req, res) => {
  try {
    const [suppliers, locations] = await Promise.all([
      Supplier.findAll(),
      Location.findAll(),
    ]);
    res.render('items/form', { title: 'New Item', item: undefined, suppliers, locations, activePage: 'items' });
  } catch (err) {
    console.error('Item new error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load form', activePage: 'items' });
  }
});

// Create item
router.post('/', async (req, res) => {
  try {
    const { part_number, name, description, supplier_id, location_id, cost_per_unit,
            reorder_point, reorder_quantity, container_quantity, lead_time_days,
            safety_factor, current_stock, unit_of_measure, label_color, supplier_url,
            pack_size, order_unit } = req.body;
    const newItem = await Item.create({
      part_number, name, description,
      unit_of_measure: unit_of_measure || 'each',
      supplier_id: supplier_id || null,
      location_id: location_id || null,
      cost_per_unit: parseFloat(cost_per_unit) || null,
      reorder_point: parseInt(reorder_point) || 10,
      reorder_quantity: parseInt(reorder_quantity) || 10,
      container_quantity: parseInt(container_quantity) || 1,
      lead_time_days: parseInt(lead_time_days) || 1,
      safety_factor: parseFloat(safety_factor) || 1.5,
      current_stock: parseInt(current_stock) || 0,
      label_color: label_color || '#000000',
      supplier_url: supplier_url || null,
      pack_size: parseInt(pack_size) || 1,
      order_unit: order_unit === 'pack' ? 'pack' : 'unit',
    });

    // Auto-generate the first Kanban card with QR code
    await createCardWithQR(newItem.id, newItem.location_id);

    res.flash('success', 'Item created with initial card');
    res.redirect(`/items/${newItem.id}`);
  } catch (err) {
    console.error('Item create error:', err);
    res.flash('error', 'Failed to create item: ' + err.message);
    res.redirect('/items/new');
  }
});

// CSV import
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.flash('error', 'No file uploaded');
      return res.redirect('/items');
    }
    const records = parseItemsCsv(req.file.buffer);
    let imported = 0;
    for (const record of records) {
      if (record.part_number && record.name) {
        const created = await Item.create(record);
        await createCardWithQR(created.id, created.location_id);
        imported++;
      }
    }
    res.flash('success', `Successfully imported ${imported} items`);
    res.redirect('/items');
  } catch (err) {
    console.error('Item import error:', err);
    res.flash('error', 'Failed to import items. Check CSV format.');
    res.redirect('/items');
  }
});

// Clone item — pre-fills the new item form with data from an existing item
router.get('/:id/clone', async (req, res) => {
  try {
    const [source, suppliers, locations] = await Promise.all([
      Item.findById(req.params.id),
      Supplier.findAll(),
      Location.findAll(),
    ]);
    if (!source) {
      res.flash('error', 'Item not found');
      return res.redirect('/items');
    }
    // Create a clone object with cleared part_number (must be unique)
    const item = {
      ...source,
      id: undefined,
      part_number: source.part_number + '-COPY',
      name: source.name + ' (Copy)',
    };
    res.render('items/form', { title: 'Clone Item', item, suppliers, locations, activePage: 'items' });
  } catch (err) {
    console.error('Item clone error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to clone item', activePage: 'items' });
  }
});

// Show item with linked cards
router.get('/:id', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) {
      res.flash('error', 'Item not found');
      return res.redirect('/items');
    }
    const cards = await Card.findByItemId(item.id);
    const scanResult = await query(
      `SELECT sh.*, c.card_uid, u.name AS scanned_by_name
       FROM scan_history sh
       JOIN cards c ON sh.card_id = c.id
       LEFT JOIN "user" u ON sh.scanned_by = u.id
       WHERE c.item_id = $1
       ORDER BY sh.scanned_at DESC
       LIMIT 20`,
      [item.id]
    );
    res.render('items/show', {
      title: item.name,
      item,
      cards,
      scanHistory: scanResult.rows,
      activePage: 'items',
    });
  } catch (err) {
    console.error('Item show error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load item', activePage: 'items' });
  }
});

// Pull a card into the order queue for this item (used by dashboard "Order" button)
router.post('/:id/queue', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) {
      res.flash('error', 'Item not found');
      return res.redirect('/items');
    }

    // Check if any card for this item is already in queue or in the order pipeline
    const existingPipeline = await query(
      `SELECT id, status FROM cards
       WHERE item_id = $1 AND status IN ('in_queue', 'ordered', 'in_transit', 'received')
       LIMIT 1`,
      [item.id]
    );
    if (existingPipeline.rows.length > 0) {
      const status = existingPipeline.rows[0].status;
      res.flash('warning', `${item.name} is already ${status.replace(/_/g, ' ')}. No new card created.`);
      return res.redirect('/orders/queue');
    }

    // Try to pull an existing at_location card into the queue
    const atLocation = await query(
      `SELECT id FROM cards WHERE item_id = $1 AND status = 'at_location' ORDER BY loop_number LIMIT 1`,
      [item.id]
    );

    let cardId;
    if (atLocation.rows.length > 0) {
      cardId = atLocation.rows[0].id;
      await query(
        `UPDATE cards SET status = 'in_queue', last_scanned_at = NOW(), last_scanned_by = $2, updated_at = NOW()
         WHERE id = $1`,
        [cardId, req.authUser.id]
      );
    } else {
      // No cards at all for this item — create one and queue it
      const card = await createCardWithQR(item.id, item.location_id);
      cardId = card.id;
      await query(
        `UPDATE cards SET status = 'in_queue', last_scanned_at = NOW(), last_scanned_by = $2 WHERE id = $1`,
        [cardId, req.authUser.id]
      );
    }

    // Record the pull in scan history
    await ScanHistory.create({
      card_id: cardId,
      scanned_by: req.authUser.id,
      action: 'pull',
      previous_status: 'at_location',
      new_status: 'in_queue',
      notes: 'Queued from dashboard',
    });

    res.flash('success', `${item.name} added to the order queue`);
    res.redirect('/orders/queue');
  } catch (err) {
    console.error('Queue item error:', err);
    res.flash('error', 'Failed to queue item for ordering');
    res.redirect('/dashboard');
  }
});

// Edit item form
router.get('/:id/edit', async (req, res) => {
  try {
    const [item, suppliers, locations] = await Promise.all([
      Item.findById(req.params.id),
      Supplier.findAll(),
      Location.findAll(),
    ]);
    if (!item) {
      res.flash('error', 'Item not found');
      return res.redirect('/items');
    }
    res.render('items/form', { title: `Edit ${item.name}`, item, suppliers, locations, activePage: 'items' });
  } catch (err) {
    console.error('Item edit error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load item', activePage: 'items' });
  }
});

// Update item
router.put('/:id', async (req, res) => {
  try {
    const { part_number, name, description, supplier_id, location_id, cost_per_unit,
            reorder_point, reorder_quantity, container_quantity, lead_time_days,
            safety_factor, current_stock, unit_of_measure, label_color, supplier_url,
            pack_size, order_unit } = req.body;
    await Item.update(req.params.id, {
      part_number, name, description,
      unit_of_measure: unit_of_measure || 'each',
      supplier_id: supplier_id || null,
      location_id: location_id || null,
      cost_per_unit: parseFloat(cost_per_unit) || null,
      reorder_point: parseInt(reorder_point) || 10,
      reorder_quantity: parseInt(reorder_quantity) || 10,
      container_quantity: parseInt(container_quantity) || 1,
      lead_time_days: parseInt(lead_time_days) || 1,
      safety_factor: parseFloat(safety_factor) || 1.5,
      current_stock: parseInt(current_stock) || 0,
      label_color: label_color || '#000000',
      supplier_url: supplier_url || null,
      pack_size: parseInt(pack_size) || 1,
      order_unit: order_unit === 'pack' ? 'pack' : 'unit',
    });
    res.flash('success', 'Item updated successfully');
    res.redirect(`/items/${req.params.id}`);
  } catch (err) {
    console.error('Item update error:', err);
    res.flash('error', 'Failed to update item');
    res.redirect(`/items/${req.params.id}/edit`);
  }
});

// Deactivate item (also deletes associated cards)
router.delete('/:id', async (req, res) => {
  try {
    // Delete cards first (scan_history cascades from cards)
    const cardsDeleted = await query(
      `DELETE FROM cards WHERE item_id = $1 RETURNING id`,
      [req.params.id]
    );
    await Item.deactivate(req.params.id);
    const n = cardsDeleted.rowCount;
    res.flash('success', `Item deactivated${n > 0 ? ` and ${n} card${n === 1 ? '' : 's'} removed` : ''}`);
    res.redirect('/items');
  } catch (err) {
    console.error('Item deactivate error:', err);
    res.flash('error', 'Failed to deactivate item');
    res.redirect('/items');
  }
});

// Reactivate item (restore a deactivated item; auto-creates a fresh Kanban card)
router.post('/:id/reactivate', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) {
      res.flash('error', 'Item not found');
      return res.redirect('/items?status=inactive');
    }

    // Check that the part_number doesn't collide with an active item
    const collision = await query(
      `SELECT id, name FROM items WHERE part_number = $1 AND is_active = true AND id <> $2 LIMIT 1`,
      [item.part_number, item.id]
    );
    if (collision.rows.length > 0) {
      res.flash('error', `Part number "${item.part_number}" is already used by active item "${collision.rows[0].name}". Edit one of them first.`);
      return res.redirect('/items?status=inactive');
    }

    await query(`UPDATE items SET is_active = true, updated_at = NOW() WHERE id = $1`, [item.id]);

    // Give it a fresh card since deactivation removed the old ones
    await createCardWithQR(item.id, item.location_id);

    res.flash('success', `${item.name} reactivated with a new Kanban card`);
    res.redirect(`/items/${item.id}`);
  } catch (err) {
    console.error('Item reactivate error:', err);
    res.flash('error', 'Failed to reactivate item');
    res.redirect('/items?status=inactive');
  }
});

export default router;
