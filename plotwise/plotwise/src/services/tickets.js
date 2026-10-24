const { one, run } = require('../db');

// Keyword triage used when n8n is not connected; the n8n workflow uses an LLM instead.
const CATS = [
  ['plumbing', /leak|pipe|tap|drain|water|flush|geyser|seepage/i],
  ['electrical', /power|electric|socket|switch|wiring|spark|short|breaker|light/i],
  ['hvac', /\bac\b|air con|heater|cooling|heating|fan|ventilat/i],
  ['carpentry', /door|window|cabinet|wardrobe|lock|hinge|wood/i],
  ['cleaning', /clean|pest|cockroach|garbage|mould|mold/i],
];

async function applyTicketTriage(ticketId, { category, urgency, ai_summary }) {
  const vendor = await one('SELECT * FROM vendors WHERE trade=? AND is_active=1 ORDER BY id LIMIT 1', [category]);
  await run(`UPDATE maintenance_tickets SET category=?, urgency=?, ai_summary=?, vendor_id=?, status=IF(? IS NULL,'open','assigned') WHERE id=?`,
    [category, urgency, String(ai_summary || '').slice(0, 490), vendor ? vendor.id : null, vendor ? vendor.id : null, ticketId]);
  return vendor;
}

async function localTicketTriage(ticket) {
  const text = `${ticket.title} ${ticket.description || ''}`;
  const category = (CATS.find(([, re]) => re.test(text)) || ['general'])[0];
  const urgency = /gas|fire|flood|spark|burst|no power|shock/i.test(text) ? 'emergency' : /leak|no water|broken|not working|locked/i.test(text) ? 'high' : 'medium';
  await applyTicketTriage(ticket.id, { category, urgency, ai_summary: `Keyword triage: ${category} issue, ${urgency} urgency.` });
}

module.exports = { applyTicketTriage, localTicketTriage };
