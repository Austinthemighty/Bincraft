import 'dotenv/config';
import { initDatabase, pool } from './index.js';

await initDatabase();
await pool.end();
