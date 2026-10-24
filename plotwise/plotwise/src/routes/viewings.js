const r = require('express').Router();
const rateLimit = require('express-rate-limit');
const { q, one, run } = require('../db');
const { auth, roles, STAFF } = require('../auth');
const { trigger } = require('../automation/n8n');
const { createLead, slimProperty } = require('../services/leads');

const limiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: { error: 'Too many requests. Try again later' } });
const HOURS = [10, 11, 12, 13, 14, 15, 16, 17];
const norm = (s) => String(s).replace('T', ' ').slice(0, 16) + ':00';

// Free hourly slots for a property's agent on a date (YYYY-MM-DD)
r.get('/availability', async (req, res) => {
  const { property_id, date } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'Pick a date' });
  const prop = await one('SELECT agent_id FROM properties WHERE id=?', [property_id]);
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  const now = (await one('SELECT NOW() AS n')).n;
  const taken = new Set((await q(`SELECT TIME_FORMAT(scheduled_at,'%H:%i') t FROM viewings WHERE agent_id<=>? AND DATE(scheduled_at)=? AND status='scheduled'`, [prop.agent_id, date])).map((x) => x.t));
  const slots = HOURS.map((h) => `${String(h).padStart(2, '0')}:00`).filter((t) => !taken.has(t) && `${date} ${t}:00` > now);
  res.json(slots);
});

// Public booking
r.post('/', limiter, async (req, res) => {
  const b = req.body || {};
  if (!b.property_id || !b.scheduled_at) return res.status(400).json({ error: 'Choose a property, date and time' });
  if (!b.lead_id && (!b.name || !(b.email || b.phone))) return res.status(400).json({ error: 'Name and an email or phone number are required' });
  const when = norm(b.scheduled_at);
  const prop = await one('SELECT * FROM properties WHERE id=?', [b.property_id]);
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  if (when <= (await one('SELECT NOW() AS n')).n) return res.status(400).json({ error: 'Pick a time in the future' });
  if (await one(`SELECT id FROM viewings WHERE agent_id<=>? AND scheduled_at=? AND status='scheduled'`, [prop.agent_id, when])) return res.status(409).json({ error: 'That slot was just taken. Pick another' });

  let lead;
  if (b.lead_id) lead = await one('SELECT * FROM leads WHERE id=?', [b.lead_id]);
  else ({ lead } = await createLead({ ...b, property_id: prop.id, message: `Viewing request for ${when.slice(0, 16)}` }, { skipAutomation: true }));
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const x = await run('INSERT INTO viewings (lead_id, property_id, agent_id, scheduled_at) VALUES (?,?,?,?)', [lead.id, prop.id, prop.agent_id, when]);
  await run(`UPDATE leads SET status='viewing_booked' WHERE id=?`, [lead.id]);
  await run(`INSERT INTO lead_activities (lead_id,type,details) VALUES (?, 'viewing_booked', ?)`, [lead.id, JSON.stringify({ scheduled_at: when, property: prop.title })]);

  const agent = prop.agent_id ? await one('SELECT id,name,email,telegram_chat_id FROM users WHERE id=?', [prop.agent_id]) : null;
  const viewing = await one('SELECT * FROM viewings WHERE id=?', [x.insertId]);
  await trigger('viewing_scheduler', 'viewing-booked', { viewing, lead, property: slimProperty(prop), agent }, { entityType: 'viewing', entityId: viewing.id });
  res.status(201).json({ id: viewing.id, scheduled_at: when });
});

r.get('/', auth(), roles(...STAFF), async (_req, res) => {
  res.json(await q(
    `SELECT v.*, l.name AS lead_name, l.email AS lead_email, l.phone AS lead_phone, p.title AS property_title, u.name AS agent_name
     FROM viewings v JOIN leads l ON l.id=v.lead_id JOIN properties p ON p.id=v.property_id LEFT JOIN users u ON u.id=v.agent_id
     ORDER BY v.scheduled_at DESC LIMIT 100`));
});

r.patch('/:id', auth(), roles(...STAFF), async (req, res) => {
  const { status, feedback } = req.body || {};
  const v = await one('SELECT * FROM viewings WHERE id=?', [req.params.id]);
  if (!v) return res.status(404).json({ error: 'Viewing not found' });
  await run('UPDATE viewings SET status=COALESCE(?,status), feedback=COALESCE(?,feedback) WHERE id=?', [status || null, feedback || null, v.id]);
  if (status === 'completed' && v.status !== 'completed') {
    await run(`UPDATE leads SET status='negotiation' WHERE id=? AND status IN ('new','contacted','viewing_booked')`, [v.lead_id]);
    const lead = await one('SELECT * FROM leads WHERE id=?', [v.lead_id]);
    const prop = await one('SELECT * FROM properties WHERE id=?', [v.property_id]);
    const agent = v.agent_id ? await one('SELECT id,name,email FROM users WHERE id=?', [v.agent_id]) : null;
    await trigger('post_viewing_followup', 'viewing-completed', { viewing: v, lead, property: slimProperty(prop), agent }, { entityType: 'viewing', entityId: v.id });
  }
  res.json({ ok: true });
});

module.exports = r;
