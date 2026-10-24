require('dotenv').config();
require('express-async-errors');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { auth } = require('./auth');
const { ensureSchema, seedIfEmpty } = require('./setup');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/viewings', require('./routes/viewings'));
app.use('/api/deals', require('./routes/deals'));
app.use('/api/management', require('./routes/management'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/automations', require('./routes/demo'));
app.use('/api/automation', require('./routes/automation'));
app.get('/api/agents', auth(), async (_req, res) => res.json(await require('./db').q("SELECT id,name FROM users WHERE role IN ('agent','admin') AND is_active=1")));
app.get('/api/landlords', auth(), async (_req, res) => res.json(await require('./db').q("SELECT id,name FROM users WHERE role='landlord'")));

app.use(express.static(path.join(__dirname, '../public')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side' : err.message });
});

const port = process.env.PORT || 3000;
(async () => {
  await ensureSchema();
  if (process.env.DEMO_SEED === 'true') await seedIfEmpty();
  app.listen(port, () => console.log(`Plotwise running on http://localhost:${port}`));
})().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
