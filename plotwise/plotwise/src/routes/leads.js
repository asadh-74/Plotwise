const r = require('express').Router();
const rateLimit = require('express-rate-limit');
const { q, one, run } = require('../db');
const { auth, roles, STAFF } = require('../auth');
const { createLead } = require('../services/leads');

const limiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Try again later' } });

// Public inquiry form
r.post('/', limiter, async (req, res) => {
  const b = req.body || {};
  if (!b.name || !(b.email || b.phone)) return res.status(400).json({ error: 'Name and an email or phone number are required' });
  if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) return res.status(400).json({ error: 'Email address looks invalid' });
  const { lead } = await createLead({ ...b, source: ['website', 'whatsapp', 'referral', 'social', 'portal'].includes(b.source) ? b.source : 'website' });
  res.status(201).json({ id: lead.id, message: 'Thanks, we will reply within a minute.' });
});

r.get('/', auth(), roles(...STAFF), async (req, res) => {
  const f = req.query, w = [], p = [];
  if (f.status) { w.push('l.status=?'); p.push(f.status); }
  if (f.label) { w.push('l.score_label=?'); p.push(f.label); }
  if (f.q) { w.push('(l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)'); const s = `%${f.q}%`; p.push(s, s, s); }
  res.json(await q(
    `SELECT l.*, p.title AS property_title, u.name AS agent_name FROM leads l
     LEFT JOIN properties p ON p.id=l.property_id LEFT JOIN users u ON u.id=l.assigned_agent_id
     ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY l.created_at DESC LIMIT 200`, p));
});

r.get('/:id', auth(), roles(...STAFF), async (req, res) => {
  const lead = await one(`SELECT l.*, p.title AS property_title, p.price AS property_price, p.listing_type AS property_listing_type, u.name AS agent_name
    FROM leads l LEFT JOIN properties p ON p.id=l.property_id LEFT JOIN users u ON u.id=l.assigned_agent_id WHERE l.id=?`, [req.params.id]);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  lead.activities = await q('SELECT * FROM lead_activities WHERE lead_id=? ORDER BY created_at, id', [lead.id]);
  lead.messages = await q('SELECT * FROM messages WHERE lead_id=? ORDER BY created_at, id', [lead.id]);
  lead.viewings = await q('SELECT * FROM viewings WHERE lead_id=? ORDER BY scheduled_at', [lead.id]);
  res.json(lead);
});

r.patch('/:id', auth(), roles(...STAFF), async (req, res) => {
  const { status, assigned_agent_id, note } = req.body || {};
  const lead = await one('SELECT * FROM leads WHERE id=?', [req.params.id]);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (status && status !== lead.status) {
    await run('UPDATE leads SET status=? WHERE id=?', [status, lead.id]);
    await run(`INSERT INTO lead_activities (lead_id,type,details) VALUES (?, 'status_change', ?)`, [lead.id, JSON.stringify({ from: lead.status, to: status, by: req.user.name })]);
  }
  if (assigned_agent_id) {
    await run('UPDATE leads SET assigned_agent_id=? WHERE id=?', [assigned_agent_id, lead.id]);
    await run(`INSERT INTO lead_activities (lead_id,type,details) VALUES (?, 'assigned', ?)`, [lead.id, JSON.stringify({ agent_id: assigned_agent_id, by: req.user.name })]);
  }
  if (note) await run(`INSERT INTO lead_activities (lead_id,type,details) VALUES (?, 'note', ?)`, [lead.id, JSON.stringify({ text: note, by: req.user.name })]);
  res.json({ ok: true });
});

module.exports = r;
