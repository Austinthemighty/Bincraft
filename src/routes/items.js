import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import multer from 'multer';
import * as Item from '../models/Item.js';
import * as Supplier from '../models/Supplier.js';
import * as Location from '../models/Location.js';
import * as Card from '../models/Card.js';
import * as ScanHistory from '../models/ScanHistory.js';
import { parseItemsCsv } from '../utils/csv.js';
import { query } from '../db/index.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(requireAuth);

// List items
router.get('/', async (req, res) => {
  try {
    const { search, supplier_id, page } = req.query;
    const result = await Item.findAll({
      search,
      supplier_id,
      is_active: true,
      page: parseInt(page, 10) || 1,
    });
    const suppliers = await Supplier.findAll();
    res.render('items/index', {
      title: 'Items',
      items: result.items,
      pagination: { page: result.page, totalPages: result.totalPages, total: result.total },
      suppliers,
      filters: { search: search || '', supplier_id: supplier_id || '' },
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
            safety_factor, current_stock, unit_of_measure, label_color } = req.body;
    await Item.create({
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
      label_color: label_color || '#ffffff',
    });
    res.flash('success', 'Item created successfully');
    res.redirect('/items');
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
        await Item.create(record);
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
            safety_factor, current_stock, unit_of_measure, label_color } = req.body;
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
      label_color: label_color || '#ffffff',
    });
    res.flash('success', 'Item updated successfully');
    res.redirect(`/items/${req.params.id}`);
  } catch (err) {
    console.error('Item update error:', err);
    res.flash('error', 'Failed to update item');
    res.redirect(`/items/${req.params.id}/edit`);
  }
});

// Deactivate item
router.delete('/:id', async (req, res) => {
  try {
    await Item.deactivate(req.params.id);
    res.flash('success', 'Item deactivated');
    res.redirect('/items');
  } catch (err) {
    console.error('Item deactivate error:', err);
    res.flash('error', 'Failed to deactivate item');
    res.redirect('/items');
  }
});

export default router;
