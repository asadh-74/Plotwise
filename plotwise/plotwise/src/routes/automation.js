// Endpoints that n8n calls. Every route requires the x-automation-secret header.
const r = require('express').Router();
const { q, one, run } = require('../db');
const { automationSecret } = require('../auth');
const { finishRun } = require('../automation/n8n');
const { applyLeadScore } = require('../services/leads');
const { applyTicketTriage } = require('../services/tickets');

r.use(automationSecret);
r.get('/ping', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---- run log ---------------------------------------------------------------------------------
r.post('/runs/:id/finish', async (req, res) => {
  await finishRun(Number(req.params.id), req.body?.status === 'failed' ? 'failed' : 'success', req.body?.error || null);
  res.json({ ok: true });
});
// For scheduled workflows that have no run row yet
r.post('/runs/log', async (req, res) => {
  const b = req.body || {};
  const x = await run(
    `INSERT INTO automation_runs (workflow, trigger_type, entity_type, entity_id, status, payload, error, finished_at) VALUES (?, 'schedule', ?,?,?,?,?, NOW(3))`,
    [b.workflow || 'unknown', b.entity_type || null, b.entity_id || null, b.status === 'failed' ? 'failed' : 'success', JSON.stringify(b.payload || {}), b.error || null]);
  res.json({ id: x.insertId });
});

// ---- 1. lead instant reply + scoring ---------------------------------------------------------
r.post('/leads/:id/score', async (req, res) => {
  const b = req.body || {};
  if (!(await one('SELECT id FROM leads WHERE id=?', [req.params.id]))) return res.status(404).json({ error: 'Lead not found' });
  await applyLeadScore(Number(req.params.id), {
    score: Math.max(0, Math.min(100, Number(b.score) || 50)),
    label: ['hot', 'warm', 'cold'].includes(b.label) ? b.label : 'warm',
    reason: b.reason, channel: b.channel, reply_subject: b.reply_subject, reply_body: b.reply_body, message_status: b.message_status,
  });
  res.json({ ok: true });
});

// ---- 2. follow-up drip (day 3, 7, 14) --------------------------------------------------------
r.get('/due-followups', async (_req, res) => {
  res.json(await q(
    `SELECT l.id, l.name, l.email, l.phone, l.message, l.followup_step, l.score_label, p.title AS property_title, p.price AS property_price, u.name AS agent_name
     FROM leads l LEFT JOIN properties p ON p.id=l.property_id LEFT JOIN users u ON u.id=l.assigned_agent_id
     WHERE l.status IN ('new','contacted') AND l.next_followup_at <= NOW() AND l.followup_step < 3 AND l.email IS NOT NULL LIMIT 20`));
});
r.post('/leads/:id/followup-sent', async (req, res) => {
  const b = req.body || {};
  const lead = await one('SELECT followup_step FROM leads WHERE id=?', [req.params.id]);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const step = lead.followup_step + 1;
  const gap = { 1: 4, 2: 7 }[step]; // day 3 -> day 7 -> day 14 -> stop
  await run(`UPDATE leads SET followup_step=?, last_contacted_at=NOW(), next_followup_at=${gap ? 'DATE_ADD(NOW(), INTERVAL ? DAY)' : 'NULL'} WHERE id=?`, gap ? [step, gap, req.params.id] : [step, req.params.id]);
  await run(`INSERT INTO lead_activities (lead_id,type,details) VALUES (?, 'followup_sent', ?)`, [req.params.id, JSON.stringify({ step })]);
  await run(`INSERT INTO messages (lead_id,channel,subject,body,generated_by,status,sent_at) VALUES (?, 'email', ?,?, 'ai','sent', NOW())`, [req.params.id, b.subject || 'Following up', b.body || '']);
  res.json({ ok: true, step });
});

// ---- 3. AI listing content -------------------------------------------------------------------
r.post('/properties/:id/ai-content', async (req, res) => {
  const b = req.body || {};
  await run('UPDATE properties SET ai_description=?, social_posts=? WHERE id=?', [b.ai_description || null, b.social_posts ? JSON.stringify(b.social_posts) : null, req.params.id]);
  res.json({ ok: true });
});

// ---- 4. viewing scheduler --------------------------------------------------------------------
r.post('/viewings/:id/calendar', async (req, res) => {
  await run('UPDATE viewings SET calendar_event_id=? WHERE id=?', [req.body?.calendar_event_id || null, req.params.id]);
  res.json({ ok: true });
});
r.get('/due-reminders', async (_req, res) => {
  res.json(await q(
    `SELECT v.id, v.scheduled_at, l.name AS lead_name, l.email AS lead_email, p.title AS property_title, p.address, p.city, u.name AS agent_name, u.phone AS agent_phone
     FROM viewings v JOIN leads l ON l.id=v.lead_id JOIN properties p ON p.id=v.property_id LEFT JOIN users u ON u.id=v.agent_id
     WHERE v.status='scheduled' AND v.reminder_sent=0 AND v.scheduled_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR) AND l.email IS NOT NULL`));
});
r.post('/viewings/:id/reminder-sent', async (req, res) => {
  await run('UPDATE viewings SET reminder_sent=1 WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ---- 5. rent reminders + lease expiry --------------------------------------------------------
r.get('/rent-due', async (_req, res) => {
  await run(`UPDATE rent_payments SET status='overdue' WHERE status='pending' AND due_date < CURDATE()`);
  res.json(await q(
    `SELECT rp.id, rp.due_date, rp.amount, rp.status, rp.reminders_sent, DATEDIFF(CURDATE(), rp.due_date) AS days_overdue,
       pr.title AS property_title, t.name AS tenant_name, t.email AS tenant_email, ll.name AS landlord_name, ll.email AS landlord_email
     FROM rent_payments rp JOIN leases le ON le.id=rp.lease_id JOIN properties pr ON pr.id=le.property_id
     JOIN users t ON t.id=le.tenant_id JOIN users ll ON ll.id=le.landlord_id
     WHERE rp.status IN ('pending','overdue') AND rp.due_date <= DATE_ADD(CURDATE(), INTERVAL 3 DAY) AND rp.reminders_sent < 4 LIMIT 50`));
});
r.post('/rent/:id/reminded', async (req, res) => {
  await run('UPDATE rent_payments SET reminders_sent=reminders_sent+1 WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});
r.get('/expiring-leases', async (_req, res) => {
  await run(`UPDATE leases SET status='expiring' WHERE status='active' AND end_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)`);
  res.json(await q(
    `SELECT le.id, le.end_date, le.monthly_rent, DATEDIFF(le.end_date, CURDATE()) AS days_left, pr.title AS property_title,
       t.name AS tenant_name, t.email AS tenant_email, ll.name AS landlord_name, ll.email AS landlord_email
     FROM leases le JOIN properties pr ON pr.id=le.property_id JOIN users t ON t.id=le.tenant_id JOIN users ll ON ll.id=le.landlord_id
     WHERE le.status IN ('active','expiring') AND DATEDIFF(le.end_date, CURDATE()) IN (90,60,30,14,7)`));
});

// ---- 6. maintenance triage -------------------------------------------------------------------
r.post('/tickets/:id/triage', async (req, res) => {
  const b = req.body || {};
  const category = ['plumbing', 'electrical', 'hvac', 'carpentry', 'cleaning', 'general'].includes(b.category) ? b.category : 'general';
  const urgency = ['low', 'medium', 'high', 'emergency'].includes(b.urgency) ? b.urgency : 'medium';
  const vendor = await applyTicketTriage(Number(req.params.id), { category, urgency, ai_summary: b.ai_summary });
  res.json({ category, urgency, vendor });
});

// ---- 7. weekly digest + owner statements -----------------------------------------------------
r.get('/weekly-digest', async (_req, res) => {
  const properties = await q(`SELECT id,title,listing_type,price,bedrooms,city,area_sqft FROM properties WHERE status='active' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) ORDER BY created_at DESC LIMIT 6`);
  const fallback = properties.length ? [] : await q(`SELECT id,title,listing_type,price,bedrooms,city,area_sqft FROM properties WHERE status='active' ORDER BY created_at DESC LIMIT 6`);
  const deals = await q(`SELECT title,price,estimated_price,price_gap_pct,city,area_name FROM market_listings WHERE is_undervalued=1 ORDER BY price_gap_pct DESC LIMIT 5`);
  const subscribers = await q(`SELECT DISTINCT u.id,u.name,u.email FROM saved_searches s JOIN users u ON u.id=s.user_id WHERE s.is_active=1 AND s.frequency='weekly'`);
  res.json({ properties: properties.length ? properties : fallback, deals, subscribers });
});
r.get('/owner-statements', async (req, res) => {
  const period = /^\d{4}-\d{2}$/.test(req.query.period || '') ? req.query.period : (await one(`SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH),'%Y-%m') p`)).p;
  const rows = await q(
    `SELECT ll.id AS landlord_id, ll.name AS landlord_name, ll.email AS landlord_email, pr.title AS property_title, rp.amount, rp.due_date, rp.paid_at
     FROM rent_payments rp JOIN leases le ON le.id=rp.lease_id JOIN properties pr ON pr.id=le.property_id JOIN users ll ON ll.id=le.landlord_id
     WHERE rp.status='paid' AND DATE_FORMAT(rp.paid_at,'%Y-%m')=?`, [period]);
  const by = {};
  for (const x of rows) {
    const s = (by[x.landlord_id] ||= { landlord_id: x.landlord_id, landlord_name: x.landlord_name, landlord_email: x.landlord_email, period, items: [], rent_collected: 0 });
    s.items.push({ property: x.property_title, amount: x.amount, paid_at: x.paid_at });
    s.rent_collected += x.amount;
  }
  const expenses = await q(`SELECT pr.owner_id AS landlord_id, COUNT(*) n FROM maintenance_tickets t JOIN properties pr ON pr.id=t.property_id WHERE DATE_FORMAT(t.created_at,'%Y-%m')=? GROUP BY pr.owner_id`, [period]);
  for (const e of expenses) if (by[e.landlord_id]) by[e.landlord_id].tickets = e.n;
  res.json(Object.values(by));
});
r.post('/owner-statements', async (req, res) => {
  const b = req.body || {};
  await run(`INSERT INTO owner_statements (landlord_id,period,rent_collected,expenses,sent_at) VALUES (?,?,?,?,NOW())
             ON DUPLICATE KEY UPDATE rent_collected=VALUES(rent_collected), expenses=VALUES(expenses), sent_at=NOW()`, [b.landlord_id, b.period, b.rent_collected || 0, b.expenses || 0]);
  res.json({ ok: true });
});

// ---- 8. deal alerts --------------------------------------------------------------------------
r.post('/alerts/:id/sent', async (req, res) => {
  await run('UPDATE alerts SET sent_at=NOW() WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = r;
