import 'dotenv/config';
import { createApp } from './src/app.js';
import { pool, initDatabase } from './src/db/index.js';

const PORT = process.env.PORT || 3000;

async function start() {
  await initDatabase();
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`ItemCards running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});

process.on('SIGTERM', () => pool.end());
process.on('SIGINT', () => pool.end());
