import { query } from '../db/index.js';

export async function get(key) {
  const result = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return result.rows[0]?.value || null;
}

export async function set(key, value) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  );
}

export async function getAll() {
  const result = await query('SELECT key, value FROM app_settings ORDER BY key');
  const settings = {};
  for (const row of result.rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

export async function getAppUrl() {
  return (await get('app_url')) || process.env.BETTER_AUTH_URL || 'http://localhost:3000';
}
