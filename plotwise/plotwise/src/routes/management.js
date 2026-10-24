const r = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { q, one, run, tx } = require('../db');
const { auth, roles, STAFF } = require('../auth');
const { trigger } = require('../automation/n8n');
const { rentSchedule } = require('../services/management');
const { localTicketTriage } = require('../services/tickets');

// Role scoping used by every list below
const scope = (u, alias = 'le') =>
  STAFF.includes(u.role) ? ['1=1', []] : u.role === 'landlord' ? [`${alias}.landlord_id=?`, [u.id]] : [`${alias}.tenant_id=?`, [u.id]];

r.get('/leases', auth(), async (req, res) => {
  const [w, p] = scope(req.user);
  res.json(await q(
    `SELECT le.*, pr.title AS property_title, t.name AS tenant_name, t.email AS tenant_email, ll.name AS landlord_name,
       DATEDIFF(le.end_date, CURDATE()) AS days_left
     FROM leases le JOIN properties pr ON pr.id=le.property_id JOIN users t ON t.id=le.tenant_id JOIN users ll ON ll.id=le.landlord_id
     WHERE ${w} ORDER BY le.end_date`, p));
});

// Lead -> tenant -> lease -> monthly rent schedule
r.post('/leases', auth(), roles(...STAFF), async (req, res) => {
  const b = req.body || {};
  if (!b.property_id || !b.start_date || !b.end_date || !b.monthly_rent) return res.status(400).json({ error: 'Property, dates and monthly rent are required' });
  if (b.end_date <= b.start_date) return res.status(400).json({ error: 'End date must be after the start date' });
  const prop = await one('SELECT * FROM properties WHERE id=?', [b.property_id]);
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  if (!prop.owner_id) return res.status(400).json({ error: 'Set an owner (landlord) on this property first' });
  if (await one(`SELECT id FROM leases WHERE property_id=? AND status IN ('active','expiring')`, [prop.id])) return res.status(409).json({ error: 'This property already has an active lease' });

  const out = await tx(async (x) => {
    let tenantId = b.tenant_id, tempPassword = null;
    const lead = b.lead_id ? (await x('SELECT * FROM leads WHERE id=?', [b.lead_id]))[0] : null;
    if (!tenantId && lead) {
      const ex = lead.email && (await x('SELECT id FROM users WHERE email=?', [lead.email]))[0];
      if (ex) tenantId = ex.id;
      else {
        if (!lead.email) throw Object.assign(new Error('This lead has no email, so a tenant account cannot be created'), { status: 400 });
        tempPassword = 'Tenant-' + crypto.randomBytes(3).toString('hex');
        tenantId = (await x('INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)', [lead.name, lead.email, lead.phone, await bcrypt.hash(tempPassword, 10), 'tenant'])).insertId;
      }
    }
    if (!tenantId) throw Object.assign(new Error('Choose a tenant or a lead'), { status: 400 });
    const lid = (await x('INSERT INTO leases (property_id,tenant_id,landlord_id,lead_id,start_date,end_date,monthly_rent,deposit,rent_due_day) VALUES (?,?,?,?,?,?,?,?,?)',
      [prop.id, tenantId, prop.owner_id, lead ? lead.id : null, b.start_date, b.end_date, b.monthly_rent, b.deposit || 0, b.rent_due_day || 1])).insertId;
    for (const due of rentSchedule(b.start_date, b.end_date, b.rent_due_day || 1))
      await x('INSERT INTO rent_payments (lease_id,due_date,amount) VALUES (?,?,?)', [lid, due, b.monthly_rent]);
    await x(`UPDATE properties SET status='managed' WHERE id=?`, [prop.id]);
    if (lead) {
      await x(`UPDATE leads SET status='won' WHERE id=?`, [lead.id]);
      await x(`INSERT INTO lead_activities (lead_id,type,details) VALUES (?, 'lease_created', ?)`, [lead.id, JSON.stringify({ lease_id: lid })]);
    }
    return { id: lid, tenant_id: tenantId, tenant_temp_password: tempPassword };
  });
  res.status(201).json(out);
});

r.get('/rent', auth(), async (req, res) => {
  const [w, p] = scope(req.user);
  if (req.query.status) { p.push(req.query.status); }
  res.json(await q(
    `SELECT rp.*, pr.title AS property_title, t.name AS tenant_name FROM rent_payments rp JOIN leases le ON le.id=rp.lease_id
     JOIN properties pr ON pr.id=le.property_id JOIN users t ON t.id=le.tenant_id
     WHERE ${w} ${req.query.status ? 'AND rp.status=?' : ''} ORDER BY rp.due_date DESC LIMIT 120`, p));
});

r.post('/rent/:id/pay', auth(), roles(...STAFF), async (req, res) => {
  await run(`UPDATE rent_payments SET status='paid', paid_at=NOW(), method=? WHERE id=?`, [req.body?.method || 'bank', req.params.id]);
  res.json({ ok: true });
});

r.get('/vendors', auth(), roles(...STAFF), async (_req, res) => res.json(await q('SELECT * FROM vendors WHERE is_active=1 ORDER BY trade, name')));

r.get('/tickets', auth(), async (req, res) => {
  const u = req.user;
  const [w, p] = STAFF.includes(u.role) ? ['1=1', []] : u.role === 'landlord' ? ['pr.owner_id=?', [u.id]] : ['t.reported_by=?', [u.id]];
  res.json(await q(
    `SELECT t.*, pr.title AS property_title, rb.name AS reporter_name, v.name AS vendor_name FROM maintenance_tickets t
     JOIN properties pr ON pr.id=t.property_id JOIN users rb ON rb.id=t.reported_by LEFT JOIN vendors v ON v.id=t.vendor_id
     WHERE ${w} ORDER BY FIELD(t.status,'open','assigned','in_progress','resolved','closed'), t.created_at DESC LIMIT 100`, p));
});

r.post('/tickets', auth(), async (req, res) => {
  const b = req.body || {};
  if (!b.property_id || !b.title) return res.status(400).json({ error: 'Choose the property and describe the problem' });
  const prop = await one('SELECT * FROM properties WHERE id=?', [b.property_id]);
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  const lease = await one(`SELECT id FROM leases WHERE property_id=? AND status IN ('active','expiring') LIMIT 1`, [prop.id]);
  const x = await run('INSERT INTO maintenance_tickets (property_id,lease_id,reported_by,title,description) VALUES (?,?,?,?,?)', [prop.id, lease ? lease.id : null, req.user.id, b.title, b.description || null]);
  const ticket = await one('SELECT * FROM maintenance_tickets WHERE id=?', [x.insertId]);
  const reporter = await one('SELECT id,name,email,phone FROM users WHERE id=?', [req.user.id]);
  const landlord = prop.owner_id ? await one('SELECT id,name,email,telegram_chat_id FROM users WHERE id=?', [prop.owner_id]) : null;
  const agent = prop.agent_id ? await one('SELECT id,name,email,telegram_chat_id FROM users WHERE id=?', [prop.agent_id]) : null;
  await trigger('maintenance_triage', 'maintenance-ticket', { ticket, property: { id: prop.id, title: prop.title, address: prop.address, city: prop.city }, reporter, landlord, agent },
    { entityType: 'ticket', entityId: ticket.id, fallback: (runId) => localTicketTriage(ticket) });
  res.status(201).json({ id: ticket.id });
});

r.patch('/tickets/:id', auth(), roles(...STAFF), async (req, res) => {
  const { status, vendor_id } = req.body || {};
  await run(`UPDATE maintenance_tickets SET status=COALESCE(?,status), vendor_id=COALESCE(?,vendor_id), resolved_at=IF(?='resolved', NOW(), resolved_at) WHERE id=?`, [status || null, vendor_id || null, status || '', req.params.id]);
  res.json({ ok: true });
});

module.exports = r;
