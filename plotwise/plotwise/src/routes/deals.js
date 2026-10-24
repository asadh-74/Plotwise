const r = require('express').Router();
const { q, one, run, j } = require('../db');
const { auth, roles, STAFF } = require('../auth');
const { importRows, matchSavedSearches, sampleRows } = require('../services/deals');

const VIEW = [...STAFF, 'buyer'];

r.get('/', auth(), roles(...VIEW), async (req, res) => {
  const f = req.query, w = [], p = [];
  if (f.undervalued === '1') w.push('m.is_undervalued=1');
  if (f.city) { w.push('m.city=?'); p.push(f.city); }
  if (f.listing_type) { w.push('m.listing_type=?'); p.push(f.listing_type); }
  res.json(await q(`SELECT m.* FROM market_listings m ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY m.price_gap_pct DESC LIMIT 150`, p));
});

// CSV/JSON importer: { rows: [...] } or { sample: true }
r.post('/import', auth(), roles(...STAFF), async (req, res) => {
  const rows = req.body?.sample ? sampleRows() : req.body?.rows;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Send rows[] or sample:true' });
  const ids = await importRows(rows, req.body?.sample ? 'sample' : 'import');
  const alerts = await matchSavedSearches(ids);
  const undervalued = (await one('SELECT COUNT(*) c FROM market_listings WHERE is_undervalued=1')).c;
  res.json({ imported: ids.length, undervalued, alerts_created: alerts });
});

// Deal -> draft listing in the CRM
r.post('/:id/promote', auth(), roles(...STAFF), async (req, res) => {
  const m = await one('SELECT * FROM market_listings WHERE id=?', [req.params.id]);
  if (!m) return res.status(404).json({ error: 'Deal not found' });
  if (m.promoted_property_id) return res.status(409).json({ error: 'Already promoted', property_id: m.promoted_property_id });
  const x = await run(
    `INSERT INTO properties (agent_id,title,description,listing_type,status,property_type,price,bedrooms,area_sqft,address,city,lat,lng,source,market_listing_id)
     VALUES (?,?,?,?,'draft',?,?,?,?,?,?,?,?, 'deal_finder', ?)`,
    [req.user.role === 'agent' ? req.user.id : null, m.title, `Found by Deal Finder ${m.price_gap_pct}% below the estimated fair price.`, m.listing_type, m.property_type, m.price, m.bedrooms, m.area_sqft, m.area_name, m.city, m.lat, m.lng, m.id]
  );
  await run('UPDATE market_listings SET promoted_property_id=? WHERE id=?', [x.insertId, m.id]);
  res.status(201).json({ property_id: x.insertId });
});

// Saved searches
r.get('/saved-searches', auth(), async (req, res) => {
  const rows = await q('SELECT * FROM saved_searches WHERE user_id=? ORDER BY id DESC', [req.user.id]);
  res.json(rows.map((s) => ({ ...s, filters: j(s.filters) })));
});
r.post('/saved-searches', auth(), roles(...VIEW), async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name the search' });
  const f = b.filters || {};
  const x = await run('INSERT INTO saved_searches (user_id,name,filters,frequency,channel) VALUES (?,?,?,?,?)', [req.user.id, b.name, JSON.stringify(f), b.frequency || 'instant', b.channel || 'email']);
  res.status(201).json({ id: x.insertId });
});
r.delete('/saved-searches/:id', auth(), async (req, res) => {
  await run('DELETE FROM saved_searches WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});
r.get('/alerts', auth(), async (req, res) => {
  res.json(await q(
    `SELECT a.*, s.name AS search_name, m.title, m.price, m.price_gap_pct, m.city FROM alerts a JOIN saved_searches s ON s.id=a.saved_search_id
     LEFT JOIN market_listings m ON m.id=a.market_listing_id WHERE s.user_id=? ORDER BY a.id DESC LIMIT 30`, [req.user.id]));
});

module.exports = r;
