import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CERTS_DIR = join(ROOT, 'data', 'certs');
const SELF_SIGNED_DIR = join(CERTS_DIR, 'selfsigned');
const LE_DIR = join(CERTS_DIR, 'letsencrypt');
const ACME_DIR = join(CERTS_DIR, 'acme-challenge');

/**
 * Resolve SSL certificates based on SSL_MODE.
 * Returns { cert, key } buffers or null if no certs available.
 */
export async function resolveCerts() {
  const mode = (process.env.SSL_MODE || 'auto').toLowerCase();

  console.log(`[SSL] Mode: ${mode}`);

  // 1. Custom certs
  if (mode === 'custom') {
    return loadCustomCerts();
  }

  // 2. Let's Encrypt
  if (mode === 'letsencrypt') {
    return await loadOrObtainLetsEncrypt();
  }

  // 3. Auto (self-signed, default)
  if (mode === 'auto') {
    return loadOrGenerateSelfSigned();
  }

  // 4. Explicitly disabled
  if (mode === 'off' || mode === 'none' || mode === 'http') {
    console.log('[SSL] Disabled — HTTP only');
    return null;
  }

  console.log(`[SSL] Unknown mode "${mode}", falling back to auto`);
  return loadOrGenerateSelfSigned();
}

/**
 * Check if Let's Encrypt certs need renewal (older than 60 days).
 */
export async function checkRenewal() {
  if ((process.env.SSL_MODE || '').toLowerCase() !== 'letsencrypt') return;

  const domain = process.env.SSL_DOMAIN;
  if (!domain) return;

  const certPath = join(LE_DIR, 'fullchain.pem');
  if (!existsSync(certPath)) return;

  const stat = statSync(certPath);
  const ageMs = Date.now() - stat.mtimeMs;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays < 60) {
    console.log(`[SSL] Let's Encrypt cert is ${Math.floor(ageDays)} days old — no renewal needed`);
    return;
  }

  console.log(`[SSL] Let's Encrypt cert is ${Math.floor(ageDays)} days old — attempting renewal`);
  try {
    await obtainLetsEncrypt();
    console.log('[SSL] Renewal successful');
  } catch (err) {
    console.error('[SSL] Renewal failed:', err.message);
  }
}

/**
 * Get the ACME challenge directory for HTTP-01 validation.
 */
export function getAcmeChallengeDir() {
  mkdirSync(ACME_DIR, { recursive: true });
  return ACME_DIR;
}

// ─── Custom Certs ───

function loadCustomCerts() {
  const certPath = process.env.SSL_CERT;
  const keyPath = process.env.SSL_KEY;

  if (!certPath || !keyPath) {
    console.error('[SSL] SSL_MODE=custom but SSL_CERT or SSL_KEY not set');
    return null;
  }

  if (!existsSync(certPath) || !existsSync(keyPath)) {
    console.error(`[SSL] Certificate files not found: ${certPath}, ${keyPath}`);
    return null;
  }

  try {
    const cert = readFileSync(certPath);
    const key = readFileSync(keyPath);
    console.log('[SSL] Loaded custom certificates');
    return { cert, key };
  } catch (err) {
    console.error('[SSL] Failed to read custom certificates:', err.message);
    return null;
  }
}

// ─── Self-Signed ───

function loadOrGenerateSelfSigned() {
  const certPath = join(SELF_SIGNED_DIR, 'cert.pem');
  const keyPath = join(SELF_SIGNED_DIR, 'key.pem');

  // Try to load existing
  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const cert = readFileSync(certPath);
      const key = readFileSync(keyPath);
      console.log('[SSL] Loaded existing self-signed certificate');
      return { cert, key };
    } catch (err) {
      console.error('[SSL] Failed to read existing self-signed cert:', err.message);
    }
  }

  // Generate new
  return generateSelfSigned();
}

function generateSelfSigned() {
  const certPath = join(SELF_SIGNED_DIR, 'cert.pem');
  const keyPath = join(SELF_SIGNED_DIR, 'key.pem');

  try {
    // Check openssl is available
    execSync('openssl version', { stdio: 'pipe' });
  } catch {
    console.error('[SSL] openssl not found — cannot generate self-signed certificate');
    console.error('[SSL] Install openssl or set SSL_MODE=custom with your own certs');
    return null;
  }

  try {
    mkdirSync(SELF_SIGNED_DIR, { recursive: true });

    console.log('[SSL] Generating self-signed certificate...');

    const subj = '/CN=localhost/O=ItemCards/OU=Development';
    const san = 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1';

    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes ` +
      `-keyout "${keyPath}" ` +
      `-out "${certPath}" ` +
      `-days 365 ` +
      `-subj "${subj}" ` +
      `-addext "${san}" ` +
      `2>/dev/null`,
      { stdio: 'pipe' }
    );

    const cert = readFileSync(certPath);
    const key = readFileSync(keyPath);
    console.log('[SSL] Self-signed certificate generated (valid 365 days)');
    return { cert, key };
  } catch (err) {
    console.error('[SSL] Failed to generate self-signed certificate:', err.message);
    // Clean up partial files
    try { unlinkSync(certPath); } catch {}
    try { unlinkSync(keyPath); } catch {}
    return null;
  }
}

// ─── Let's Encrypt ───

async function loadOrObtainLetsEncrypt() {
  const certPath = join(LE_DIR, 'fullchain.pem');
  const keyPath = join(LE_DIR, 'privkey.pem');

  // Try to load existing
  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const cert = readFileSync(certPath);
      const key = readFileSync(keyPath);
      console.log("[SSL] Loaded existing Let's Encrypt certificate");

      // Check if renewal is needed
      await checkRenewal();

      // Reload in case renewed
      return {
        cert: readFileSync(certPath),
        key: readFileSync(keyPath),
      };
    } catch (err) {
      console.error("[SSL] Failed to read Let's Encrypt cert:", err.message);
    }
  }

  // Obtain new
  return await obtainLetsEncrypt();
}

async function obtainLetsEncrypt() {
  const domain = process.env.SSL_DOMAIN;
  const email = process.env.SSL_EMAIL || '';

  if (!domain) {
    console.error("[SSL] SSL_MODE=letsencrypt but SSL_DOMAIN not set");
    return null;
  }

  // Check certbot is available
  try {
    execSync('certbot --version', { stdio: 'pipe' });
  } catch {
    console.error("[SSL] certbot not found — install it: https://certbot.eff.org/");
    return null;
  }

  mkdirSync(LE_DIR, { recursive: true });

  const certPath = join(LE_DIR, 'fullchain.pem');
  const keyPath = join(LE_DIR, 'privkey.pem');
  const cfApiToken = process.env.SSL_CF_API_TOKEN;
  const cfZoneId = process.env.SSL_CF_ZONE_ID;

  try {
    let cmd;

    if (cfApiToken) {
      // DNS-01 via Cloudflare
      console.log("[SSL] Obtaining Let's Encrypt cert via Cloudflare DNS challenge...");

      const cfCredPath = join(CERTS_DIR, '.cloudflare.ini');
      writeFileSync(cfCredPath, `dns_cloudflare_api_token = ${cfApiToken}\n`, { mode: 0o600 });

      cmd = `certbot certonly --non-interactive --agree-tos ` +
        `${email ? `--email "${email}"` : '--register-unsafely-without-email'} ` +
        `--dns-cloudflare ` +
        `--dns-cloudflare-credentials "${cfCredPath}" ` +
        `--cert-path "${certPath}" ` +
        `--key-path "${keyPath}" ` +
        `--fullchain-path "${certPath}" ` +
        `-d "${domain}"`;

    } else {
      // HTTP-01 challenge (webroot)
      console.log("[SSL] Obtaining Let's Encrypt cert via HTTP-01 challenge...");
      console.log("[SSL] Make sure port 80 is accessible and DNS points to this server.");

      mkdirSync(ACME_DIR, { recursive: true });

      cmd = `certbot certonly --non-interactive --agree-tos ` +
        `${email ? `--email "${email}"` : '--register-unsafely-without-email'} ` +
        `--webroot -w "${ACME_DIR}" ` +
        `--cert-path "${certPath}" ` +
        `--key-path "${keyPath}" ` +
        `--fullchain-path "${certPath}" ` +
        `-d "${domain}"`;
    }

    execSync(cmd, { stdio: 'inherit' });

    const cert = readFileSync(certPath);
    const key = readFileSync(keyPath);
    console.log("[SSL] Let's Encrypt certificate obtained successfully");
    return { cert, key };

  } catch (err) {
    console.error("[SSL] Failed to obtain Let's Encrypt certificate:", err.message);
    return null;
  }
}
