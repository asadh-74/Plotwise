require('dotenv').config();
const { ensureSchema, seedIfEmpty } = require('../src/setup');
(async () => { await ensureSchema(); await seedIfEmpty(); process.exit(0); })().catch((e) => { console.error(e.message); process.exit(1); });
