import 'dotenv/config';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import express from 'express';
import { createApp } from './src/app.js';
import { pool, initDatabase } from './src/db/index.js';
import { resolveCerts, checkRenewal, getAcmeChallengeDir } from './src/ssl.js';

const HTTP_PORT = parseInt(process.env.HTTP_PORT || '80', 10);
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '443', 10);

async function start() {
  await initDatabase();
  const app = createApp();

  // Resolve SSL certificates
  const certs = await resolveCerts();

  if (certs) {
    // ── HTTPS mode: main app on HTTPS, HTTP redirects ──
    const httpsServer = createHttpsServer({ cert: certs.cert, key: certs.key }, app);

    // HTTP server: serve ACME challenges + redirect everything else to HTTPS
    const httpApp = express();
    const acmeDir = getAcmeChallengeDir();
    httpApp.use('/.well-known/acme-challenge', express.static(acmeDir));
    httpApp.use((req, res) => {
      const host = req.headers.host?.replace(/:\d+$/, '') || 'localhost';
      const port = HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`;
      res.redirect(301, `https://${host}${port}${req.url}`);
    });
    const httpServer = createHttpServer(httpApp);

    // Start both servers
    httpsServer.listen(HTTPS_PORT, () => {
      console.log(`ItemCards (HTTPS) running at https://localhost${HTTPS_PORT === 443 ? '' : ':' + HTTPS_PORT}`);
    }).on('error', (err) => {
      if (err.code === 'EACCES') {
        console.error(`[SSL] Port ${HTTPS_PORT} requires elevated privileges.`);
        console.error(`[SSL] Try: sudo npm start, or set HTTPS_PORT to a higher port (e.g., 8443)`);
      } else {
        console.error('[SSL] HTTPS server error:', err.message);
      }
      process.exit(1);
    });

    httpServer.listen(HTTP_PORT, () => {
      console.log(`ItemCards (HTTP→HTTPS redirect) on port ${HTTP_PORT}`);
    }).on('error', (err) => {
      if (err.code === 'EACCES') {
        console.warn(`[SSL] Port ${HTTP_PORT} requires elevated privileges — HTTP redirect disabled.`);
        console.warn(`[SSL] HTTPS is still running. Set HTTP_PORT to a higher port (e.g., 8080) if needed.`);
      } else {
        console.warn('[SSL] HTTP server error (non-fatal):', err.message);
      }
    });

    // Schedule daily cert renewal check (every 24 hours)
    setInterval(() => {
      checkRenewal().catch(err => console.error('[SSL] Renewal check error:', err.message));
    }, 24 * 60 * 60 * 1000);

  } else {
    // ── HTTP-only mode ──
    const httpServer = createHttpServer(app);

    httpServer.listen(HTTP_PORT, () => {
      console.log(`ItemCards (HTTP) running at http://localhost${HTTP_PORT === 80 ? '' : ':' + HTTP_PORT}`);
    }).on('error', (err) => {
      if (err.code === 'EACCES') {
        console.error(`Port ${HTTP_PORT} requires elevated privileges.`);
        console.error(`Try: sudo npm start, or set HTTP_PORT to a higher port (e.g., 8080)`);
      } else {
        console.error('Server error:', err.message);
      }
      process.exit(1);
    });
  }
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});

process.on('SIGTERM', () => pool.end());
process.on('SIGINT', () => pool.end());
