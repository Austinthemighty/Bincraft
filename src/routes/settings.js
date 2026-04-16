import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as Settings from '../models/Settings.js';
import { query } from '../db/index.js';
import { generateQRDataUrl } from '../utils/qr.js';
import { auth } from '../lib/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const settings = await Settings.getAll();
  const usersResult = await query(
    'SELECT id, name, email, role, "createdAt" FROM "user" ORDER BY "createdAt"'
  );
  res.render('settings/index', {
    title: 'Settings',
    activePage: 'settings',
    settings,
    users: usersResult.rows,
  });
});

// Update app URL
router.post('/app-url', async (req, res) => {
  try {
    let { app_url } = req.body;
    app_url = app_url.replace(/\/+$/, '');
    await Settings.set('app_url', app_url);
    res.flash('success', 'App URL updated');
    res.redirect('/settings');
  } catch (err) {
    console.error('Settings update error:', err);
    res.flash('error', 'Failed to update settings');
    res.redirect('/settings');
  }
});

// Regenerate all QR codes
router.post('/regenerate-qr', async (req, res) => {
  try {
    const appUrl = await Settings.getAppUrl();
    const cardsResult = await query('SELECT id, card_uid FROM cards');
    let count = 0;
    for (const card of cardsResult.rows) {
      const scanUrl = `${appUrl}/scan/card/${card.card_uid}`;
      const qrDataUrl = await generateQRDataUrl(scanUrl);
      await query(
        'UPDATE cards SET qr_data_url = $1, updated_at = NOW() WHERE id = $2',
        [qrDataUrl, card.id]
      );
      count++;
    }
    res.flash('success', `Regenerated QR codes for ${count} cards`);
    res.redirect('/settings');
  } catch (err) {
    console.error('QR regeneration error:', err);
    res.flash('error', 'Failed to regenerate QR codes');
    res.redirect('/settings');
  }
});

// Create new user (admin only)
router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      res.flash('error', 'Name, email, and password are required');
      return res.redirect('/settings');
    }

    // Use better-auth's sign-up API internally
    const result = await auth.api.signUpEmail({
      body: { name, email, password },
    });

    if (result?.user?.id) {
      // Set the role
      const userRole = ['admin', 'user', 'viewer'].includes(role) ? role : 'user';
      await query('UPDATE "user" SET role = $1 WHERE id = $2', [userRole, result.user.id]);
      res.flash('success', `Account created for ${name}`);
    } else {
      res.flash('error', 'Failed to create account');
    }
    res.redirect('/settings');
  } catch (err) {
    console.error('Create user error:', err);
    const msg = err.message?.includes('UNIQUE') ? 'Email already exists' : 'Failed to create account';
    res.flash('error', msg);
    res.redirect('/settings');
  }
});

// Update user role (admin only)
router.post('/users/:id/role', requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'user', 'viewer'].includes(role)) {
      res.flash('error', 'Invalid role');
      return res.redirect('/settings');
    }
    await query('UPDATE "user" SET role = $1 WHERE id = $2', [role, req.params.id]);
    res.flash('success', 'User role updated');
    res.redirect('/settings');
  } catch (err) {
    console.error('Update role error:', err);
    res.flash('error', 'Failed to update role');
    res.redirect('/settings');
  }
});

export default router;
