const r = require('express').Router();
const { q, one, run } = require('../db');
const { auth, roles, STAFF } = require('../auth');
const { createLead } = require('../services/leads');

// What the automations page shows next to the live run log
const WORKFLOWS = [
  { key: 'lead_instant_reply', name: 'Instant reply and lead scoring', trigger: 'New inquiry', does: 'AI scores the lead, emails a reply that mentions the property, alerts the agent on Telegram if the lead is hot' },
  { key: 'followup_drip', name: 'Follow-up drip', trigger: 'Hourly schedule', does: 'Nudges unanswered leads on day 3, 7 and 14' },
  { key: 'viewing_scheduler', name: 'Viewing scheduler', trigger: 'Viewing booked', does: 'Creates the Google Calendar event and emails a confirmation' },
  { key: 'viewing_reminder', name: 'Viewing reminders', trigger: 'Hourly schedule', does: 'Reminds the lead 24 hours before the visit' },
  { key: 'post_viewing_followup', name: 'Post-visit follow-up', trigger: 'Viewing completed', does: 'Thanks the lead and asks for feedback' },
  { key: 'new_listing_content', name: 'Listing content writer', trigger: 'New listing', does: 'Writes the description and social posts' },
  { key: 'weekly_digest', name: 'Weekly digest', trigger: 'Monday 09:00', does: 'Emails new listings and bargains to subscribers' },
  { key: 'deal_alert', name: 'Deal alerts', trigger: 'Undervalued deal matches a saved search', does: 'Sends the alert by email or Telegram' },
  { key: 'rent_reminder', name: 'Rent reminders', trigger: 'Daily 09:00', does: 'Reminds tenants before and after the due date, escalates to the landlord' },
  { key: 'lease_expiry', name: 'Lease expiry alerts', trigger: 'Daily 09:00', does: 'Warns tenant and landlord 90, 60, 30, 14 and 7 days out' },
  { key: 'maintenance_triage', name: 'Maintenance triage', trigger: 'New ticket', does: 'AI sets category and urgency, assigns a vendor, alerts on emergencies' },
  { key: 'owner_statement', name: 'Owner statements', trigger: '1st of the month', does: 'Emails each landlord last month\'s rent summary' },
];

r.get('/runs', auth(), roles(...STAFF), async (_req, res) => {
  await run("UPDATE automation_runs SET status='failed', error='No answer from n8n within 5 minutes', finished_at=NOW(3) WHERE status='running' AND started_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)");
  const runs = await q('SELECT id, workflow, trigger_type, entity_type, entity_id, status, duration_ms, error, started_at FROM automation_runs ORDER BY id DESC LIMIT 40');
  res.json({ runs, workflows: WORKFLOWS, mode: process.env.N8N_WEBHOOK_BASE ? 'n8n' : 'local' });
});

const PEOPLE = ['Ahmed Khan', 'Fatima Noor', 'Usman Ali', 'Ayesha Malik', 'Hamza Sheikh', 'Maryam Qureshi', 'Bilal Ahmad', 'Sana Iqbal'];
const MESSAGES = [
  (t) => `Hi, I am ready to buy and can visit this weekend. Is ${t} still available?`,
  (t) => `Interested in ${t}. Please share the final price and if I can see it tomorrow.`,
  (t) => `Just browsing. What area is ${t} in?`,
  (t) => `Do you have the documents for ${t}? Budget is flexible, want to move fast.`,
];

// "Simulate a new lead" button: creates a realistic inquiry and fires the automation
r.post('/simulate-lead', auth(), roles(...STAFF), async (_req, res) => {
  const prop = await one("SELECT * FROM properties WHERE status='active' ORDER BY RAND() LIMIT 1");
  if (!prop) return res.status(400).json({ error: 'Add an active listing first' });
  const name = PEOPLE[Math.floor(Math.random() * PEOPLE.length)];
  const msg = MESSAGES[Math.floor(Math.random() * MESSAGES.length)](prop.title);
  const rich = Math.random() > 0.4;
  const { lead, automation } = await createLead({
    property_id: prop.id, name, email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`, phone: '+92300' + String(Math.floor(1000000 + Math.random() * 8999999)),
    message: msg, budget: Math.round(prop.price * (rich ? 1.05 : 0.6)), source: 'demo',
  });
  res.status(201).json({ lead_id: lead.id, run_id: automation.runId, mode: automation.mode });
});

module.exports = r;
