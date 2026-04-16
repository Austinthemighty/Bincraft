import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

// Check if any users exist — if not, redirect to setup
async function hasUsers() {
  const result = await query('SELECT COUNT(*) FROM "user"');
  return parseInt(result.rows[0].count, 10) > 0;
}

router.get('/login', async (req, res) => {
  if (req.authUser) return res.redirect('/dashboard');
  // If no users exist, redirect to first-run setup
  if (!(await hasUsers())) return res.redirect('/auth/setup');
  res.render('auth/login', { title: 'Sign In' });
});

// First-run setup — only accessible when no users exist
router.get('/setup', async (req, res) => {
  if (await hasUsers()) return res.redirect('/auth/login');
  res.render('auth/setup', { title: 'First-Time Setup' });
});

export default router;
