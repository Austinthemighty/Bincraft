import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as Location from '../models/Location.js';

const router = Router();

router.use(requireAuth);

// Tree view of all locations
router.get('/', async (req, res) => {
  try {
    const locations = await Location.getTree();
    res.render('locations/index', { title: 'Locations', locations, activePage: 'locations' });
  } catch (err) {
    console.error('Locations list error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load locations', activePage: 'locations' });
  }
});

// New location form
router.get('/new', async (req, res) => {
  try {
    const allLocations = await Location.findAll();
    res.render('locations/form', { title: 'New Location', location: undefined, allLocations, activePage: 'locations' });
  } catch (err) {
    console.error('Location new error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load form', activePage: 'locations' });
  }
});

// Create location
router.post('/', async (req, res) => {
  try {
    const { name, type, parent_id, description } = req.body;
    await Location.create({ name, type, parent_id: parent_id || null, description });
    res.flash('success', 'Location created successfully');
    res.redirect('/locations');
  } catch (err) {
    console.error('Location create error:', err);
    res.flash('error', 'Failed to create location');
    res.redirect('/locations/new');
  }
});

// Edit location form
router.get('/:id/edit', async (req, res) => {
  try {
    const [location, allLocations] = await Promise.all([
      Location.findById(req.params.id),
      Location.findAll(),
    ]);
    if (!location) {
      res.flash('error', 'Location not found');
      return res.redirect('/locations');
    }
    res.render('locations/form', { title: `Edit ${location.name}`, location, allLocations, activePage: 'locations' });
  } catch (err) {
    console.error('Location edit error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load location', activePage: 'locations' });
  }
});

// Update location
router.put('/:id', async (req, res) => {
  try {
    const { name, type, parent_id, description } = req.body;
    await Location.update(req.params.id, { name, type, parent_id: parent_id || null, description });
    res.flash('success', 'Location updated successfully');
    res.redirect('/locations');
  } catch (err) {
    console.error('Location update error:', err);
    res.flash('error', 'Failed to update location');
    res.redirect(`/locations/${req.params.id}/edit`);
  }
});

// Delete location
router.delete('/:id', async (req, res) => {
  try {
    const children = await Location.getChildren(req.params.id);
    if (children.length > 0) {
      res.flash('error', 'Cannot delete a location with child locations. Remove or reassign children first.');
      return res.redirect('/locations');
    }
    await Location.remove(req.params.id);
    res.flash('success', 'Location deleted');
    res.redirect('/locations');
  } catch (err) {
    console.error('Location delete error:', err);
    res.flash('error', 'Failed to delete location');
    res.redirect('/locations');
  }
});

export default router;
