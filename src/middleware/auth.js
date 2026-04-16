import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../lib/auth.js';
import { query } from '../db/index.js';

// Enrich the better-auth user with our custom role column
async function enrichUser(user) {
  if (!user) return null;
  const result = await query('SELECT role FROM "user" WHERE id = $1', [user.id]);
  return { ...user, role: result.rows[0]?.role || 'user' };
}

export async function requireAuth(req, res, next) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) {
    return res.redirect('/auth/login');
  }
  req.authUser = await enrichUser(session.user);
  req.authSession = session.session;
  next();
}

export async function requireAdmin(req, res, next) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) {
    return res.redirect('/auth/login');
  }
  const user = await enrichUser(session.user);
  if (user.role !== 'admin') {
    return res.status(403).render('error', { message: 'Admin access required', title: 'Forbidden' });
  }
  req.authUser = user;
  req.authSession = session.session;
  next();
}

export async function loadUser(req, res, next) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  req.authUser = session ? await enrichUser(session.user) : null;
  req.authSession = session?.session || null;
  res.locals.currentUser = req.authUser;
  next();
}
