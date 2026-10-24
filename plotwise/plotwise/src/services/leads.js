const { one, run } = require('../db');
const { trigger, finishRun } = require('../automation/n8n');

const slimProperty = (p) =>
  p && { id: p.id, title: p.title, listing_type: p.listing_type, price: p.price, currency: p.currency, bedrooms: p.bedrooms, city: p.city, address: p.address, area_sqft: p.area_sqft };

async function createLead(d, { skipAutomation = false } = {}) {
  const prop = d.property_id ? await one('SELECT * FROM properties WHERE id=?', [d.property_id]) : null;
  let agentId = prop && prop.agent_id;
  if (!agentId) agentId = (await one("SELECT id FROM users WHERE role='agent' AND is_active=1 ORDER BY id LIMIT 1"))?.id || null;

  const r = await run(
    `INSERT INTO leads (property_id, assigned_agent_id, name, email, phone, message, budget, source, status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [prop ? prop.id : null, agentId, d.name, d.email || null, d.phone || null, d.message || null, d.budget || null, d.source || 'website', d.status || 'new']
  );
  const id = r.insertId;
  await run(`INSERT INTO lead_activities (lead_id, type, details) VALUES (?, 'created', ?)`, [id, JSON.stringify({ source: d.source || 'website' })]);

  const lead = await one('SELECT * FROM leads WHERE id=?', [id]);
  let automation = null;
  if (!skipAutomation) {
    const agent = agentId ? await one('SELECT id, name, email, telegram_chat_id FROM users WHERE id=?', [agentId]) : null;
    automation = await trigger('lead_instant_reply', 'lead-created', { lead, property: slimProperty(prop), agent }, {
      entityType: 'lead',
      entityId: id,
      fallback: (runId) => localLeadAutomation(lead, prop, runId),
    });
  }
  return { lead, automation };
}

/** Called by n8n (or the local fallback) once the AI has scored the lead and the reply was sent. */
async function applyLeadScore(leadId, d) {
  const status = d.message_status === 'queued' ? 'queued' : 'sent';
  await run(
    `UPDATE leads SET score=?, score_label=?, score_reason=?, status=IF(status='new','contacted',status),
       last_contacted_at=NOW(), next_followup_at=DATE_ADD(NOW(), INTERVAL 3 DAY), followup_step=0 WHERE id=?`,
    [d.score, d.label, String(d.reason || '').slice(0, 490), leadId]
  );
  await run(`INSERT INTO lead_activities (lead_id, type, details) VALUES (?, 'scored', ?)`, [leadId, JSON.stringify({ score: d.score, label: d.label, reason: d.reason })]);
  await run(`INSERT INTO lead_activities (lead_id, type, details) VALUES (?, 'ai_reply_sent', ?)`, [leadId, JSON.stringify({ channel: d.channel, status })]);
  await run(
    `INSERT INTO messages (lead_id, channel, direction, subject, body, generated_by, status, sent_at) VALUES (?,?, 'outbound', ?,?, 'ai', ?, NOW())`,
    [leadId, d.channel || 'email', d.reply_subject, d.reply_body, status]
  );
}

// ---- Local fallback so the demo works even before n8n is connected -----------------------------
function ruleScore(lead, prop) {
  let s = 40;
  const msg = lead.message || '';
  const price = prop ? prop.price : null;
  if (lead.budget && price) s += lead.budget >= price * 0.9 ? 25 : lead.budget >= price * 0.7 ? 10 : -10;
  if (/today|tomorrow|weekend|asap|urgent|this week|visit|viewing|ready to/i.test(msg)) s += 20;
  if (msg.length > 40) s += 8;
  if (lead.phone) s += 7;
  s = Math.max(5, Math.min(98, s));
  const label = s >= 75 ? 'hot' : s >= 50 ? 'warm' : 'cold';
  const reason = `Rule-based score: ${lead.budget ? 'budget stated' : 'no budget'}, ${/visit|viewing|today|tomorrow|weekend/i.test(msg) ? 'wants a visit soon' : 'no urgency signal'}`;
  return { score: s, label, reason };
}

async function localLeadAutomation(lead, prop, runId) {
  const { score, label, reason } = ruleScore(lead, prop);
  const title = prop ? prop.title : 'our listings';
  await applyLeadScore(lead.id, {
    score, label, reason,
    channel: lead.email ? 'email' : 'whatsapp',
    reply_subject: `Re: ${title}`,
    reply_body: `Hi ${lead.name},\n\nThanks for asking about ${title}. It is still available and I would be glad to show it to you. Reply with a day and time that suits you, or use the Book a viewing button on the listing page.\n\nBest regards,\nPlotwise team`,
    message_status: lead.email ? 'sent' : 'queued',
  });
}

module.exports = { createLead, applyLeadScore, slimProperty, finishRun };
