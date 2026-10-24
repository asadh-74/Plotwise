const r = require('express').Router();
const { q, one, run } = require('../db');
const { auth, roles, STAFF } = require('../auth');
const { trigger } = require('../automation/n8n');
const { slimProperty } = require('../services/leads');

r.get('/meta/cities', async (_req, res) => {
  res.json((await q("SELECT DISTINCT city FROM properties WHERE status='active' AND city IS NOT NULL ORDER BY city")).map((x) => x.city));
});

r.get('/', auth(false), async (req, res) => {
  const f = req.query, w = [], p = [];
  const staffAll = f.all === '1' && req.user && STAFF.includes(req.user.role);
  if (!staffAll) w.push("p.status='active'");
  if (f.q) { w.push('(p.title LIKE ? OR p.address LIKE ? OR p.city LIKE ?)'); const s = `%${f.q}%`; p.push(s, s, s); }
  if (f.city) { w.push('p.city=?'); p.push(f.city); }
  if (f.listing_type) { w.push('p.listing_type=?'); p.push(f.listing_type); }
  if (f.property_type) { w.push('p.property_type=?'); p.push(f.property_type); }
  if (f.min_price) { w.push('p.price>=?'); p.push(Number(f.min_price)); }
  if (f.max_price) { w.push('p.price<=?'); p.push(Number(f.max_price)); }
  if (f.beds) { w.push('p.bedrooms>=?'); p.push(Number(f.beds)); }
  const order = { price_asc: 'p.price ASC', price_desc: 'p.price DESC' }[f.sort] || 'p.created_at DESC';
  res.json(await q(
    `SELECT p.*, (SELECT url FROM property_images i WHERE i.property_id=p.id ORDER BY i.is_cover DESC, i.sort_order LIMIT 1) AS cover
     FROM properties p ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ${order} LIMIT 100`, p));
});

r.get('/:id', async (req, res) => {
  const prop = await one(`SELECT p.*, u.name AS agent_name, u.phone AS agent_phone FROM properties p LEFT JOIN users u ON u.id=p.agent_id WHERE p.id=?`, [req.params.id]);
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  prop.images = await q('SELECT url FROM property_images WHERE property_id=? ORDER BY is_cover DESC, sort_order', [prop.id]);
  res.json(prop);
});

r.post('/', auth(), roles(...STAFF), async (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.price || !b.listing_type) return res.status(400).json({ error: 'Title, price and listing type are required' });
  const x = await run(
    `INSERT INTO properties (owner_id, agent_id, title, description, listing_type, status, property_type, price, bedrooms, bathrooms, area_sqft, address, city, lat, lng)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.owner_id || null, req.user.role === 'agent' ? req.user.id : b.agent_id || null, b.title, b.description || null, b.listing_type, b.status || 'active', b.property_type || 'house', b.price,
     b.bedrooms || null, b.bathrooms || null, b.area_sqft || null, b.address || null, b.city || null, b.lat || null, b.lng || null]
  );
  const images = (b.images || []).filter(Boolean);
  for (let i = 0; i < images.length; i++) await run('INSERT INTO property_images (property_id,url,sort_order,is_cover) VALUES (?,?,?,?)', [x.insertId, images[i], i, i === 0 ? 1 : 0]);
  const prop = await one('SELECT * FROM properties WHERE id=?', [x.insertId]);
  const agent = prop.agent_id ? await one('SELECT id,name,email,telegram_chat_id FROM users WHERE id=?', [prop.agent_id]) : null;
  const automation = await trigger('new_listing_content', 'new-listing', { property: { ...slimProperty(prop), description: prop.description }, agent }, { entityType: 'property', entityId: prop.id });
  res.status(201).json({ id: prop.id, automation });
});

r.put('/:id', auth(), roles(...STAFF), async (req, res) => {
  const b = req.body || {};
  const fields = ['title', 'description', 'listing_type', 'status', 'property_type', 'price', 'bedrooms', 'bathrooms', 'area_sqft', 'address', 'city', 'lat', 'lng'];
  const sets = fields.filter((k) => b[k] !== undefined);
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  await run(`UPDATE properties SET ${sets.map((k) => `${k}=?`).join(', ')} WHERE id=?`, [...sets.map((k) => b[k]), req.params.id]);
  res.json({ ok: true });
});

module.exports = r;
