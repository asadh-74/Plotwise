const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { connectionConfig, q, one, run } = require('./db');
const { importRows, sampleRows } = require('./services/deals');
const { rentSchedule } = require('./services/management');

async function ensureSchema() {
  const exists = await one("SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='users'");
  if (exists.c) return false;
  const conn = await mysql.createConnection(connectionConfig({ multipleStatements: true }));
  try {
    await conn.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));
  } finally {
    await conn.end();
  }
  console.log('Schema created');
  return true;
}

const PW = 'demo1234';
const img = (k) => [0, 1, 2].map((i) => `https://picsum.photos/seed/plotwise-${k}-${i}/900/600`);

async function seedDemo() {
  const hash = await bcrypt.hash(PW, 10);
  const mk = async (name, email, role, phone, tg = null) =>
    (await run('INSERT INTO users (name,email,phone,password_hash,role,telegram_chat_id) VALUES (?,?,?,?,?,?)', [name, email, phone, hash, role, tg])).insertId;
  const admin = await mk('Admin', 'admin@plotwise.demo', 'admin', '+923000000001');
  const sara = await mk('Sara Agent', 'agent@plotwise.demo', 'agent', '+923000000002');
  const hamza = await mk('Hamza Agent', 'agent2@plotwise.demo', 'agent', '+923000000003');
  const omar = await mk('Omar Landlord', 'landlord@plotwise.demo', 'landlord', '+923000000004');
  const hina = await mk('Hina Tenant', 'tenant@plotwise.demo', 'tenant', '+923000000005');
  const bilal = await mk('Bilal Investor', 'buyer@plotwise.demo', 'buyer', '+923000000006');

  const P = [
    ['Modern 3-bed apartment, F-11', 'sale', 'apartment', 38500000, 3, 2, 1700, 'F-11 Markaz', 'Islamabad', 33.6844, 73.0124, sara, 'active'],
    ['2-bed furnished flat, F-10', 'rent', 'apartment', 85000, 2, 2, 1100, 'F-10 Markaz', 'Islamabad', 33.6938, 73.0129, sara, 'managed'],
    ['Corner house, DHA Phase 2', 'sale', 'house', 92000000, 5, 5, 4500, 'DHA Phase 2', 'Islamabad', 33.5290, 73.1450, hamza, 'active'],
    ['Studio near Centaurus', 'rent', 'apartment', 55000, 1, 1, 520, 'Jinnah Avenue', 'Islamabad', 33.7077, 73.0505, hamza, 'active'],
    ['3-bed apartment, Gulberg III', 'sale', 'apartment', 28500000, 3, 2, 1650, 'Main Boulevard', 'Lahore', 31.5204, 74.3587, sara, 'active'],
    ['Family house, Bahria Town', 'sale', 'house', 64000000, 5, 4, 4000, 'Sector C', 'Lahore', 31.3650, 74.1830, sara, 'active'],
    ['2-bed apartment, DHA Phase 5', 'rent', 'apartment', 95000, 2, 2, 1200, 'DHA Phase 5', 'Lahore', 31.4697, 74.4047, hamza, 'active'],
    ['Office floor, MM Alam Road', 'rent', 'commercial', 220000, null, 2, 2400, 'MM Alam Road', 'Lahore', 31.5100, 74.3430, hamza, 'active'],
    ['Sea-view 3-bed, Clifton', 'sale', 'apartment', 55000000, 3, 3, 2100, 'Clifton Block 4', 'Karachi', 24.8138, 67.0300, sara, 'active'],
    ['Townhouse, DHA Phase 6', 'sale', 'house', 78000000, 4, 4, 3200, 'DHA Phase 6', 'Karachi', 24.8000, 67.0700, hamza, 'active'],
    ['2-bed apartment, Gulshan-e-Iqbal', 'rent', 'apartment', 70000, 2, 2, 1050, 'Block 13-D', 'Karachi', 24.9200, 67.0900, sara, 'active'],
    ['Duplex, North Nazimabad', 'sale', 'house', 42000000, 4, 3, 2400, 'Block H', 'Karachi', 24.9400, 67.0400, hamza, 'active'],
  ];
  const pid = [];
  for (let i = 0; i < P.length; i++) {
    const [title, lt, pt, price, bd, ba, area, addr, city, lat, lng, agent, status] = P[i];
    const id = (await run(
      `INSERT INTO properties (owner_id,agent_id,title,description,listing_type,status,property_type,price,bedrooms,bathrooms,area_sqft,address,city,lat,lng,ai_description)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [omar, agent, title, `${title}. ${area} sq ft in ${addr}, ${city}.`, lt, status, pt, price, bd, ba, area, addr, city, lat, lng,
       i < 5 ? `${title} offers ${area} sq ft of well-planned living in ${addr}. Natural light, a practical layout and easy access to daily needs make it a strong ${lt === 'sale' ? 'purchase' : 'rental'} in ${city}.` : null]
    )).insertId;
    pid.push(id);
    const urls = img(i + 1);
    for (let k = 0; k < urls.length; k++) await run('INSERT INTO property_images (property_id,url,sort_order,is_cover) VALUES (?,?,?,?)', [id, urls[k], k, k === 0 ? 1 : 0]);
  }

  // Leads: [name,email,phone,propertyIdx,message,budget,source,status,score,label,reason,hoursAgo,agent]
  const L = [
    ['Ali Raza', 'ali.raza@example.com', '+923001112233', 4, 'Is this still available? I can visit this weekend and my budget is ready.', 30000000, 'website', 'viewing_booked', 88, 'hot', 'Budget above asking price and wants to visit this weekend', 5, sara],
    ['Zainab Khan', 'zainab.k@example.com', '+923004445566', 6, 'What is the minimum lease term?', 90000, 'whatsapp', 'contacted', 54, 'warm', 'Interested but gave no timeline', 30, hamza],
    ['Imran Siddiqui', 'imran.s@example.com', '+923005556677', 0, 'Please send the floor plan and final price.', 36000000, 'portal', 'contacted', 71, 'warm', 'Budget close to asking, asked for documents', 52, sara],
    ['Noor Fatima', 'noor.f@example.com', '+923007778899', 8, 'Ready to buy. Can I see it tomorrow?', 56000000, 'referral', 'negotiation', 91, 'hot', 'Referral, budget confirmed, wants a visit tomorrow', 76, sara],
    ['Kamran Butt', 'kamran.b@example.com', null, 2, 'Just browsing, what is the area?', null, 'social', 'contacted', 28, 'cold', 'No budget or timeline given', 100, hamza],
    ['Sadia Rehman', 'sadia.r@example.com', '+923008889900', 10, 'Looking to move next month. Is it furnished?', 72000, 'website', 'new', 66, 'warm', 'Clear move-in window, budget matches rent', 3, sara],
    ['Faisal Mehmood', 'faisal.m@example.com', '+923009990011', 5, 'Interested, will call later.', 50000000, 'website', 'lost', 38, 'cold', 'Budget below asking, vague intent', 190, sara],
    ['Hina Tenant', 'tenant@plotwise.demo', '+923000000005', 1, 'I would like to rent this flat.', 85000, 'website', 'won', 83, 'hot', 'Budget equals rent, wants to sign', 24 * 130, sara],
  ];
  const lid = [];
  for (const [name, email, phone, pi, msg, budget, src, status, score, label, reason, hrs, agent] of L) {
    const id = (await run(
      `INSERT INTO leads (property_id,assigned_agent_id,name,email,phone,message,budget,source,status,score,score_label,score_reason,last_contacted_at,next_followup_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, DATE_ADD(DATE_SUB(NOW(), INTERVAL ? HOUR), INTERVAL 40 SECOND),
         IF(? IN ('new','contacted'), DATE_ADD(DATE_SUB(NOW(), INTERVAL ? HOUR), INTERVAL 3 DAY), NULL), DATE_SUB(NOW(), INTERVAL ? HOUR))`,
      [pid[pi], agent, name, email, phone, msg, budget, src, status, score, label, reason, hrs, status, hrs, hrs]
    )).insertId;
    lid.push(id);
    await run(`INSERT INTO lead_activities (lead_id,type,details,created_at) SELECT id,'created',JSON_OBJECT('source',source),created_at FROM leads WHERE id=?`, [id]);
    await run(`INSERT INTO lead_activities (lead_id,type,details,created_at) SELECT id,'scored',JSON_OBJECT('score',score,'label',score_label,'reason',score_reason),DATE_ADD(created_at,INTERVAL 22 SECOND) FROM leads WHERE id=?`, [id]);
    await run(`INSERT INTO lead_activities (lead_id,type,details,created_at) SELECT id,'ai_reply_sent',JSON_OBJECT('channel',IF(email IS NULL,'whatsapp','email'),'status','sent'),DATE_ADD(created_at,INTERVAL 40 SECOND) FROM leads WHERE id=?`, [id]);
    await run(
      `INSERT INTO messages (lead_id,channel,subject,body,generated_by,status,sent_at,created_at)
       SELECT l.id, IF(l.email IS NULL,'whatsapp','email'), CONCAT('Re: ', p.title),
         CONCAT('Hi ', l.name, ', thanks for asking about ', p.title, '. It is available and I would be glad to arrange a viewing. Reply with a time that suits you.'),
         'ai','sent',DATE_ADD(l.created_at,INTERVAL 40 SECOND),DATE_ADD(l.created_at,INTERVAL 40 SECOND) FROM leads l JOIN properties p ON p.id=l.property_id WHERE l.id=?`, [id]);
  }

  // Viewings
  await run(`INSERT INTO viewings (lead_id,property_id,agent_id,scheduled_at,status) VALUES (?,?,?, TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 1 DAY),'11:00:00'),'scheduled')`, [lid[0], pid[4], sara]);
  await run(`INSERT INTO viewings (lead_id,property_id,agent_id,scheduled_at,status) VALUES (?,?,?, TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 2 DAY),'15:00:00'),'scheduled')`, [lid[3], pid[8], sara]);
  await run(`INSERT INTO viewings (lead_id,property_id,agent_id,scheduled_at,status,feedback) VALUES (?,?,?, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'14:00:00'),'completed','Liked the layout, negotiating on price')`, [lid[3], pid[8], sara]);

  // Vendors, one lease with a rent history, tickets
  for (const [n, t, ph, em] of [['Rapid Plumbing', 'plumbing', '+923111000001', 'plumber@example.com'], ['Bright Electric', 'electrical', '+923111000002', 'electrician@example.com'], ['CoolAir Services', 'hvac', '+923111000003', 'hvac@example.com'], ['FixIt General', 'general', '+923111000004', 'general@example.com'], ['Woodworks Co', 'carpentry', '+923111000005', 'carpenter@example.com']])
    await run('INSERT INTO vendors (name,trade,phone,email) VALUES (?,?,?,?)', [n, t, ph, em]);

  const startRow = await one(`SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 4 MONTH),'%Y-%m-01') s, DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 8 MONTH),'%Y-%m-01') e`);
  const lease = (await run(`INSERT INTO leases (property_id,tenant_id,landlord_id,lead_id,start_date,end_date,monthly_rent,deposit,rent_due_day) VALUES (?,?,?,?,?,?,?,?,?)`,
    [pid[1], hina, omar, lid[7], startRow.s, startRow.e, 85000, 170000, 5])).insertId;
  for (const due of rentSchedule(startRow.s, startRow.e, 5)) await run('INSERT INTO rent_payments (lease_id,due_date,amount) VALUES (?,?,?)', [lease, due, 85000]);
  await run(`UPDATE rent_payments SET status='paid', paid_at=due_date, method='bank' WHERE lease_id=? AND due_date < DATE_SUB(CURDATE(), INTERVAL 40 DAY)`, [lease]);
  await run(`UPDATE rent_payments SET status='overdue', reminders_sent=1 WHERE lease_id=? AND due_date < CURDATE() AND status='pending'`, [lease]);
  await run(`INSERT INTO lead_activities (lead_id,type,details) VALUES (?, 'lease_created', ?)`, [lid[7], JSON.stringify({ lease_id: lease })]);
  const tickets = [
    ['Kitchen tap is leaking', 'Water drips under the sink all night.', 'plumbing', 'high', 'Active leak under the kitchen sink, assign plumber today.', 1, 'assigned'],
    ['Bedroom AC not cooling', 'The AC runs but the room stays warm.', 'hvac', 'medium', 'AC cooling failure, likely gas or filter.', 3, 'in_progress'],
  ];
  for (const [t, d, c, u, s, v, st] of tickets)
    await run('INSERT INTO maintenance_tickets (property_id,lease_id,reported_by,vendor_id,title,description,category,urgency,ai_summary,status) VALUES (?,?,?,?,?,?,?,?,?,?)', [pid[1], lease, hina, v, t, d, c, u, s, st]);

  // Deal finder data + a saved search for the investor
  await importRows(sampleRows(), 'sample');
  await run('INSERT INTO saved_searches (user_id,name,filters,frequency,channel) VALUES (?,?,?,?,?)', [bilal, 'Lahore bargains', JSON.stringify({ city: 'Lahore', listing_type: 'sale', min_gap_pct: 15 }), 'instant', 'email']);
  await run('INSERT INTO saved_searches (user_id,name,filters,frequency,channel) VALUES (?,?,?,?,?)', [bilal, 'Weekly market digest', JSON.stringify({}), 'weekly', 'email']);

  // Some history so the automation page and charts are not empty on day one
  const WF = ['lead_instant_reply', 'lead_instant_reply', 'lead_instant_reply', 'followup_drip', 'viewing_scheduler', 'viewing_reminder', 'rent_reminder', 'deal_alert', 'maintenance_triage', 'new_listing_content'];
  for (let i = 0; i < 24; i++) {
    const failed = i === 7 || i === 15;
    await run(`INSERT INTO automation_runs (workflow,trigger_type,status,duration_ms,error,payload,started_at,finished_at) VALUES (?,?,?,?,?,?, DATE_SUB(NOW(), INTERVAL ? HOUR), DATE_SUB(NOW(), INTERVAL ? HOUR))`,
      [WF[i % WF.length], i % 4 === 3 ? 'schedule' : 'webhook', failed ? 'failed' : 'success', 900 + ((i * 377) % 3600), failed ? 'Gmail: quota exceeded, retried next run' : null, JSON.stringify({ mode: 'seed' }), i * 6 + 2, i * 6 + 2]);
  }
  console.log(`Demo data created. Log in with admin@plotwise.demo / ${PW} (also agent@, landlord@, tenant@, buyer@plotwise.demo)`);
}

async function seedIfEmpty() {
  if ((await one('SELECT COUNT(*) c FROM users')).c === 0) await seedDemo();
}

module.exports = { ensureSchema, seedDemo, seedIfEmpty };
