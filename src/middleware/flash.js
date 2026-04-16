// Simple cookie-based flash messages
export function flash(req, res, next) {
  // Read flash from cookie
  const raw = req.cookies?.flash;
  res.locals.flash = raw ? JSON.parse(decodeURIComponent(raw)) : null;
  // Clear flash cookie
  if (raw) {
    res.clearCookie('flash');
  }
  // Helper to set flash
  res.flash = (type, message) => {
    res.cookie('flash', encodeURIComponent(JSON.stringify({ type, message })), {
      httpOnly: true,
      maxAge: 10000,
    });
  };
  next();
}
