import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as Supplier from '../models/Supplier.js';

const router = Router();

router.use(requireAuth);

// List all suppliers
router.get('/', async (req, res) => {
  try {
    const suppliers = await Supplier.findAll(req.query.search);
    res.render('suppliers/index', { title: 'Suppliers', suppliers, search: req.query.search || '', activePage: 'suppliers' });
  } catch (err) {
    console.error('Suppliers list error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load suppliers', activePage: 'suppliers' });
  }
});

// New supplier form
router.get('/new', (req, res) => {
  res.render('suppliers/form', { title: 'New Supplier', supplier: undefined, activePage: 'suppliers' });
});

// Create supplier
router.post('/', async (req, res) => {
  try {
    const { name, contact_name, email, phone, address, notes } = req.body;
    await Supplier.create({ name, contact_name, email, phone, address, notes });
    res.flash('success', 'Supplier created successfully');
    res.redirect('/suppliers');
  } catch (err) {
    console.error('Supplier create error:', err);
    res.flash('error', 'Failed to create supplier');
    res.redirect('/suppliers/new');
  }
});

// Show supplier with stats
router.get('/:id', async (req, res) => {
  try {
    const [supplier, stats] = await Promise.all([
      Supplier.findById(req.params.id),
      Supplier.getStats(req.params.id),
    ]);
    if (!supplier) {
      res.flash('error', 'Supplier not found');
      return res.redirect('/suppliers');
    }
    res.render('suppliers/show', { title: supplier.name, supplier, stats, activePage: 'suppliers' });
  } catch (err) {
    console.error('Supplier show error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load supplier', activePage: 'suppliers' });
  }
});

// Edit supplier form
router.get('/:id/edit', async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      res.flash('error', 'Supplier not found');
      return res.redirect('/suppliers');
    }
    res.render('suppliers/form', { title: `Edit ${supplier.name}`, supplier, activePage: 'suppliers' });
  } catch (err) {
    console.error('Supplier edit error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load supplier', activePage: 'suppliers' });
  }
});

// Update supplier
router.put('/:id', async (req, res) => {
  try {
    const { name, contact_name, email, phone, address, notes } = req.body;
    await Supplier.update(req.params.id, { name, contact_name, email, phone, address, notes });
    res.flash('success', 'Supplier updated successfully');
    res.redirect(`/suppliers/${req.params.id}`);
  } catch (err) {
    console.error('Supplier update error:', err);
    res.flash('error', 'Failed to update supplier');
    res.redirect(`/suppliers/${req.params.id}/edit`);
  }
});

// Delete supplier
router.delete('/:id', async (req, res) => {
  try {
    await Supplier.remove(req.params.id);
    res.flash('success', 'Supplier deleted');
    res.redirect('/suppliers');
  } catch (err) {
    console.error('Supplier delete error:', err);
    res.flash('error', 'Failed to delete supplier. It may have linked items or orders.');
    res.redirect('/suppliers');
  }
});

export default router;
