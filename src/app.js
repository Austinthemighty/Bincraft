import express from 'express';
import expressLayouts from 'express-ejs-layouts';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import methodOverride from 'method-override';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth.js';
import { loadUser } from './middleware/auth.js';
import { flash } from './middleware/flash.js';

// Route imports
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import itemRoutes from './routes/items.js';
import cardRoutes from './routes/cards.js';
import scanRoutes from './routes/scan.js';
import orderRoutes from './routes/orders.js';
import receivingRoutes from './routes/receiving.js';
import locationRoutes from './routes/locations.js';
import supplierRoutes from './routes/suppliers.js';
import apiRoutes from './routes/api.js';
import settingsRoutes from './routes/settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

export function createApp() {
  const app = express();

  // View engine
  app.set('view engine', 'ejs');
  app.set('views', join(rootDir, 'views'));
  app.use(expressLayouts);
  app.set('layout', 'layout');

  // better-auth handler must be mounted before body parsers
  app.all('/api/auth/*splat', toNodeHandler(auth));

  // Middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
      },
    },
  }));
  // gzip/brotli compression — big win for HTML/CSS/JSON responses
  app.use(compression());

  // Request logging: concise in prod, colorful in dev
  const isDev = process.env.NODE_ENV !== 'production';
  app.use(morgan(isDev ? 'dev' : 'combined', {
    // Skip logging for static asset requests in prod to reduce noise
    skip: (req) => !isDev && /\.(css|js|svg|woff2?|png|jpg|ico)$/.test(req.url),
  }));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(methodOverride('_method'));

  // Static assets with long-lived browser cache + immutable hint
  // (SVG icon, CSS, client JS — these change rarely; if you bust in the future,
  //  add a hash to the query string or filename)
  app.use(express.static(join(rootDir, 'public'), {
    maxAge: isDev ? 0 : '1d',
    etag: true,
    lastModified: true,
  }));

  app.use(flash);
  app.use(loadUser);

  // Routes
  app.use('/auth', authRoutes);
  app.use('/dashboard', dashboardRoutes);
  app.use('/items', itemRoutes);
  app.use('/cards', cardRoutes);
  app.use('/scan', scanRoutes);
  app.use('/orders', orderRoutes);
  app.use('/receiving', receivingRoutes);
  app.use('/locations', locationRoutes);
  app.use('/suppliers', supplierRoutes);
  app.use('/api', apiRoutes);
  app.use('/settings', settingsRoutes);

  // Root redirect
  app.get('/', (req, res) => {
    res.redirect('/dashboard');
  });

  // 404
  app.use((req, res) => {
    res.status(404).render('error', { message: 'Page not found', title: '404' });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { message: 'Something went wrong', title: 'Error' });
  });

  return app;
}
