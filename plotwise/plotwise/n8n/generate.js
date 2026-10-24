/* Generates the importable n8n workflow JSON files in n8n/workflows/.
   Run: npm run workflows
   The Code-node bodies below are real JS functions, so Node syntax-checks them; n8n receives their source text. */
/* global $json, $, $input */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT = path.join(__dirname, 'workflows');
const body = (fn) => { const s = fn.toString(); return s.slice(s.indexOf('{') + 1, s.lastIndexOf('}')).trim(); };
const uid = () => crypto.randomUUID();

const CRED = {
  secret: { httpHeaderAuth: { id: '', name: 'Plotwise API Secret' } },   // header x-automation-secret
  gemini: { httpHeaderAuth: { id: '', name: 'Gemini API Key' } },        // header x-goog-api-key
  gmail: { gmailOAuth2: { id: '', name: 'Gmail account' } },
  telegram: { telegramApi: { id: '', name: 'Telegram bot' } },
  gcal: { googleCalendarOAuth2Api: { id: '', name: 'Google Calendar account' } },
};
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

class Flow {
  constructor(file, name) { this.file = file; this.name = name; this.nodes = []; this.links = []; }
  add(name, type, typeVersion, parameters, extra = {}) {
    this.nodes.push({ parameters, id: uid(), name, type, typeVersion, position: [0, 0], ...extra });
    return name;
  }
  link(a, b, out = 0) { this.links.push([a, b, out]); }
  chain(...n) { for (let i = 0; i < n.length - 1; i++) this.link(n[i], n[i + 1]); }

  // --- node factories -------------------------------------------------------------------
  webhook(name, p) { return this.add(name, 'n8n-nodes-base.webhook', 2, { httpMethod: 'POST', path: p, authentication: 'headerAuth', options: {} }, { webhookId: uid(), credentials: CRED.secret }); }
  schedule(name, rule) { return this.add(name, 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [rule] } }); }
  config() { return this.add('Config', 'n8n-nodes-base.set', 3.4, { assignments: { assignments: [{ id: uid(), name: 'api_base', value: 'https://YOUR-APP.onrender.com', type: 'string' }] }, options: {} }); }
  get(name, urlJs) { return this.add(name, 'n8n-nodes-base.httpRequest', 4.2, { method: 'GET', url: `={{ ${urlJs} }}`, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: {} }, { credentials: CRED.secret }); }
  post(name, urlJs, bodyJs, extra = {}) { return this.add(name, 'n8n-nodes-base.httpRequest', 4.2, { method: 'POST', url: `={{ ${urlJs} }}`, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${bodyJs}) }}`, options: {} }, { credentials: CRED.secret, ...extra }); }
  code(name, fn, each = true) { return this.add(name, 'n8n-nodes-base.code', 2, { jsCode: body(fn), ...(each ? { mode: 'runOnceForEachItem' } : {}) }); }
  gemini(name = 'Gemini') { return this.add(name, 'n8n-nodes-base.httpRequest', 4.2, { method: 'POST', url: GEMINI_URL, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.gemini_body) }}', options: { timeout: 30000 } }, { credentials: CRED.gemini, onError: 'continueRegularOutput' }); }
  gmail(name, to, subject, html, extra = {}) { return this.add(name, 'n8n-nodes-base.gmail', 2.1, { sendTo: `={{ ${to} }}`, subject: `={{ ${subject} }}`, message: `={{ ${html} }}`, options: { appendAttribution: false } }, { credentials: CRED.gmail, ...extra }); }
  telegram(name, chat, text) { return this.add(name, 'n8n-nodes-base.telegram', 1.2, { chatId: `={{ ${chat} }}`, text: `={{ ${text} }}`, additionalFields: { appendAttribution: false } }, { credentials: CRED.telegram, onError: 'continueRegularOutput' }); }
  iff(name, js) { return this.add(name, 'n8n-nodes-base.if', 2.2, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: uid(), leftValue: `={{ ${js} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} }); }

  json() {
    const depth = {}; const parents = {};
    this.links.forEach(([a, b]) => (parents[b] ||= []).push(a));
    const d = (n) => (depth[n] ??= (parents[n] || []).length ? Math.max(...parents[n].map(d)) + 1 : 0);
    const rows = {};
    this.nodes.forEach((n) => { const x = d(n.name); const y = (rows[x] = (rows[x] ?? -1) + 1); n.position = [x * 270, 200 + y * 190]; });
    const connections = {};
    this.links.forEach(([a, b, out]) => {
      const c = (connections[a] ||= { main: [] });
      while (c.main.length <= out) c.main.push([]);
      c.main[out].push({ node: b, type: 'main', index: 0 });
    });
    return { name: this.name, nodes: this.nodes, connections, active: false, settings: { executionOrder: 'v1', timezone: 'Asia/Karachi' }, pinData: {}, meta: { templateCredsSetupCompleted: false } };
  }
  save() { fs.writeFileSync(path.join(OUT, this.file), JSON.stringify(this.json(), null, 2)); }
}

const WB = "$('Webhook').first().json.body";               // webhook payload (run_id, api_base, ...)
const CFG = "$('Config').first().json.api_base";           // scheduled workflows: edit the Config node once
const finishWebhook = (f, parse) => f.post('Finish run', `${parse}.api_base + '/api/automation/runs/' + ${parse}.run_id + '/finish'`, "{ status: 'success' }");
const logRun = (f, workflow, extra = '') => f.post('Log run', `${CFG} + '/api/automation/runs/log'`, `{ workflow: '${workflow}'${extra} }`);

/* ============ 01. New lead: AI score + instant reply + hot-lead alert ============ */
(() => {
  const f = new Flow('01-lead-instant-reply-scoring.json', 'Plotwise 01 - Lead instant reply and scoring');
  f.webhook('Webhook', 'lead-created');
  f.code('Build prompt', function () {
    const b = $json.body; const l = b.lead; const p = b.property || {};
    const prompt = `You are a friendly assistant for a real-estate agency in Pakistan. A new lead just sent an inquiry.
Lead: ${l.name}; budget: ${l.budget || 'unknown'}; source: ${l.source}; message: "${l.message || ''}"
Property: ${p.title || 'general inquiry'}, ${p.listing_type || ''}, price ${p.price || ''} ${p.currency || ''}, ${p.bedrooms || '?'} bed, ${p.city || ''}.
Tasks: 1) score the lead 0-100 on budget fit, urgency and clarity of intent. 2) label it hot (75+), warm (50-74) or cold. 3) give a one-sentence reason. 4) write a warm reply email of at most 90 words that mentions the specific property, answers the question only with facts given above, and invites them to book a viewing.
Return ONLY JSON: {"score":number,"label":"hot|warm|cold","reason":string,"reply_subject":string,"reply_body":string}`;
    return { json: { ...b, gemini_body: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } } } };
  });
  f.gemini();
  f.code('Parse AI', function () {
    const prev = $('Build prompt').item.json; const l = prev.lead; const p = prev.property || {};
    let ai = {}; try { ai = JSON.parse($json.candidates[0].content.parts[0].text); } catch (e) { /* fall back below */ }
    const score = Math.max(0, Math.min(100, Number(ai.score) || 50));
    const label = ['hot', 'warm', 'cold'].includes(ai.label) ? ai.label : score >= 75 ? 'hot' : score >= 50 ? 'warm' : 'cold';
    const subject = ai.reply_subject || `Re: ${p.title || 'your property inquiry'}`;
    const text = ai.reply_body || `Hi ${l.name},\n\nThanks for your interest in ${p.title || 'our properties'}. I would be glad to arrange a viewing. Reply with a time that suits you.\n\nBest regards,\nPlotwise team`;
    const reason = ai.reason || 'AI scoring unavailable, default score applied';
    return { json: { api_base: prev.api_base, run_id: prev.run_id, lead: l, property: p, agent: prev.agent, score, label, is_hot: label === 'hot', has_email: !!l.email, reply_subject: subject, reply_html: text.replace(/\n/g, '<br>'),
      alert_text: `HOT lead: ${l.name} (${score}/100)\n${p.title || 'General inquiry'}\n${reason}\n${l.phone || l.email || ''}`,
      save_body: { run_id: prev.run_id, score, label, reason, reply_subject: subject, reply_body: text, channel: l.email ? 'email' : 'whatsapp', message_status: l.email ? 'sent' : 'queued' } } };
  });
  f.iff('Has email?', '$json.has_email');
  f.gmail('Send reply', '$json.lead.email', '$json.reply_subject', '$json.reply_html');
  const P = "$('Parse AI').first().json";
  f.post('Save score and reply', `${P}.api_base + '/api/automation/leads/' + ${P}.lead.id + '/score'`, `${P}.save_body`);
  f.iff('Hot lead?', `${P}.is_hot`);
  f.telegram('Alert agent', `${P}.agent?.telegram_chat_id || 'REPLACE_WITH_CHAT_ID'`, `${P}.alert_text`);
  finishWebhook(f, P);
  f.chain('Webhook', 'Build prompt', 'Gemini', 'Parse AI', 'Has email?');
  f.link('Has email?', 'Send reply', 0); f.link('Send reply', 'Save score and reply'); f.link('Has email?', 'Save score and reply', 1);
  f.link('Save score and reply', 'Hot lead?'); f.link('Hot lead?', 'Alert agent', 0); f.link('Alert agent', 'Finish run'); f.link('Hot lead?', 'Finish run', 1);
  f.save();
})();

/* ============ 02. Follow-up drip (day 3, 7, 14) ============ */
(() => {
  const f = new Flow('02-followup-drip.json', 'Plotwise 02 - Follow-up drip');
  f.schedule('Every hour', { field: 'hours', hoursInterval: 1 });
  f.config();
  f.get('Due follow-ups', `${CFG} + '/api/automation/due-followups'`);
  f.code('Build prompt', function () {
    const l = $json; const step = l.followup_step || 0;
    const tone = ['a friendly check-in (day 3)', 'a helpful follow-up that offers two viewing time options (day 7)', 'a short, no-pressure last note (day 14)'][step];
    const prompt = `You write short follow-up emails for a real-estate agency in Pakistan.
Lead: ${l.name}. Property: ${l.property_title || 'our listings'}${l.property_price ? ' (PKR ' + l.property_price + ')' : ''}. Their first message: "${l.message || ''}". Agent: ${l.agent_name || 'our team'}.
Write ${tone}. Maximum 70 words. Warm, specific, no pressure, no invented facts. Return ONLY JSON: {"subject":string,"body":string}`;
    return { json: { lead: l, api_base: $('Config').first().json.api_base, gemini_body: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.5 } } } };
  });
  f.gemini();
  f.code('Parse follow-up', function () {
    const prev = $('Build prompt').item.json; const l = prev.lead;
    let ai = {}; try { ai = JSON.parse($json.candidates[0].content.parts[0].text); } catch (e) { /* fall back below */ }
    const subject = ai.subject || `Still interested in ${l.property_title || 'a property'}?`;
    const text = ai.body || `Hi ${l.name},\n\nJust checking in about ${l.property_title || 'the property'}. I can arrange a viewing whenever suits you.\n\nBest regards,\n${l.agent_name || 'Plotwise team'}`;
    return { json: { api_base: prev.api_base, lead: l, subject, text, html: text.replace(/\n/g, '<br>') } };
  });
  f.gmail('Send follow-up', '$json.lead.email', '$json.subject', '$json.html');
  const P = "$('Parse follow-up').item.json";
  f.post('Record follow-up', `${P}.api_base + '/api/automation/leads/' + ${P}.lead.id + '/followup-sent'`, `{ subject: ${P}.subject, body: ${P}.text }`);
  f.post('Log run', `${P}.api_base + '/api/automation/runs/log'`, `{ workflow: 'followup_drip', entity_type: 'lead', entity_id: ${P}.lead.id }`);
  f.chain('Every hour', 'Config', 'Due follow-ups', 'Build prompt', 'Gemini', 'Parse follow-up', 'Send follow-up', 'Record follow-up', 'Log run');
  f.save();
})();

/* ============ 03. Viewing booked: calendar event + confirmation ============ */
(() => {
  const f = new Flow('03-viewing-booked-calendar.json', 'Plotwise 03 - Viewing scheduler');
  f.webhook('Webhook', 'viewing-booked');
  f.code('Prepare', function () {
    const b = $json.body; const v = b.viewing; const p = b.property || {}; const l = b.lead || {}; const a = b.agent || {};
    const start = v.scheduled_at.replace(' ', 'T') + '+05:00';
    const end = new Date(new Date(start).getTime() + 3600000).toISOString();
    const when = v.scheduled_at.slice(0, 16).replace('T', ' ');
    return { json: { ...b, start, end, summary: `Viewing: ${p.title} with ${l.name}`, description: `Lead: ${l.name}\nPhone: ${l.phone || '-'}\nEmail: ${l.email || '-'}\nAgent: ${a.name || '-'}`, location: [p.address, p.city].filter(Boolean).join(', '), has_email: !!l.email,
      confirm_subject: `Your viewing of ${p.title} is confirmed`,
      confirm_html: `Hi ${l.name},<br><br>Your viewing of <b>${p.title}</b> is booked for <b>${when}</b>${p.address ? ' at ' + p.address + ', ' + p.city : ''}.<br>${a.name ? 'Your agent is ' + a.name + '.<br>' : ''}<br>Reply to this email if you need to change the time.<br><br>Plotwise team` } };
  });
  f.add('Create calendar event', 'n8n-nodes-base.googleCalendar', 1.3, { calendar: { __rl: true, value: 'primary', mode: 'id' }, start: '={{ $json.start }}', end: '={{ $json.end }}', additionalFields: { summary: '={{ $json.summary }}', description: '={{ $json.description }}', location: '={{ $json.location }}' } }, { credentials: CRED.gcal });
  const P = "$('Prepare').first().json";
  f.post('Save event id', `${P}.api_base + '/api/automation/viewings/' + ${P}.viewing.id + '/calendar'`, '{ calendar_event_id: $json.id }');
  f.iff('Lead has email?', `${P}.has_email`);
  f.gmail('Confirm to lead', `${P}.lead.email`, `${P}.confirm_subject`, `${P}.confirm_html`);
  finishWebhook(f, P);
  f.chain('Webhook', 'Prepare', 'Create calendar event', 'Save event id', 'Lead has email?');
  f.link('Lead has email?', 'Confirm to lead', 0); f.link('Confirm to lead', 'Finish run'); f.link('Lead has email?', 'Finish run', 1);
  f.save();
})();

/* ============ 04. Viewing reminders (24h before) ============ */
(() => {
  const f = new Flow('04-viewing-reminders.json', 'Plotwise 04 - Viewing reminders');
  f.schedule('Every hour', { field: 'hours', hoursInterval: 1 });
  f.config();
  f.get('Due reminders', `${CFG} + '/api/automation/due-reminders'`);
  f.code('Build reminder', function () {
    const v = $json; const when = v.scheduled_at.slice(0, 16).replace('T', ' ');
    return { json: { id: v.id, api_base: $('Config').first().json.api_base, to: v.lead_email, subject: `Reminder: viewing of ${v.property_title} tomorrow`,
      html: `Hi ${v.lead_name},<br><br>A reminder that your viewing of <b>${v.property_title}</b> is at <b>${when}</b>${v.address ? ', ' + v.address + ', ' + v.city : ''}.<br>${v.agent_name ? 'Your agent ' + v.agent_name + (v.agent_phone ? ' (' + v.agent_phone + ')' : '') + ' will meet you there.<br>' : ''}<br>Plotwise team` } };
  });
  f.gmail('Send reminder', '$json.to', '$json.subject', '$json.html');
  const P = "$('Build reminder').item.json";
  f.post('Mark reminder sent', `${P}.api_base + '/api/automation/viewings/' + ${P}.id + '/reminder-sent'`, '{}');
  f.post('Log run', `${P}.api_base + '/api/automation/runs/log'`, `{ workflow: 'viewing_reminder', entity_type: 'viewing', entity_id: ${P}.id }`);
  f.chain('Every hour', 'Config', 'Due reminders', 'Build reminder', 'Send reminder', 'Mark reminder sent', 'Log run');
  f.save();
})();

/* ============ 05. Viewing completed: thank-you + feedback ============ */
(() => {
  const f = new Flow('05-post-viewing-followup.json', 'Plotwise 05 - Post-viewing follow-up');
  f.webhook('Webhook', 'viewing-completed');
  f.code('Build message', function () {
    const b = $json.body; const l = b.lead || {}; const p = b.property || {}; const a = b.agent || {};
    return { json: { ...b, has_email: !!l.email, subject: `Thanks for viewing ${p.title}`,
      html: `Hi ${l.name},<br><br>Thank you for visiting <b>${p.title}</b> today. What did you think? If you would like to make an offer, see the paperwork or book a second visit, just reply to this email${a.name ? ' and ' + a.name + ' will take it from there' : ''}.<br><br>Plotwise team` } };
  });
  f.iff('Has email?', '$json.has_email');
  f.gmail('Send thank-you', '$json.lead.email', '$json.subject', '$json.html');
  const P = "$('Build message').first().json";
  finishWebhook(f, P);
  f.chain('Webhook', 'Build message', 'Has email?');
  f.link('Has email?', 'Send thank-you', 0); f.link('Send thank-you', 'Finish run'); f.link('Has email?', 'Finish run', 1);
  f.save();
})();

/* ============ 06. New listing: AI description + social posts ============ */
(() => {
  const f = new Flow('06-new-listing-content.json', 'Plotwise 06 - Listing content writer');
  f.webhook('Webhook', 'new-listing');
  f.code('Build prompt', function () {
    const b = $json.body; const p = b.property;
    const prompt = `Write marketing copy for a property listing in Pakistan using ONLY these facts, no invented amenities.
Title: ${p.title}. For ${p.listing_type}. Price PKR ${p.price}. ${p.bedrooms || '?'} bedrooms. ${p.area_sqft || '?'} sq ft. ${p.address || ''}, ${p.city}. Notes from the agent: ${p.description || 'none'}.
Return ONLY JSON: {"ai_description":string (90-120 words, plain text),"social_posts":{"facebook":string,"instagram":string (include 5 hashtags),"linkedin":string}}`;
    return { json: { ...b, gemini_body: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.7 } } } };
  });
  f.gemini();
  f.code('Parse AI', function () {
    const prev = $('Build prompt').item.json; const p = prev.property;
    let ai = {}; try { ai = JSON.parse($json.candidates[0].content.parts[0].text); } catch (e) { /* fall back below */ }
    const desc = ai.ai_description || `${p.title}: ${p.area_sqft || ''} sq ft in ${p.address || p.city}, ${p.city}. Contact us to arrange a viewing.`;
    return { json: { api_base: prev.api_base, run_id: prev.run_id, property: p, save_body: { ai_description: desc, social_posts: ai.social_posts || null } } };
  });
  const P = "$('Parse AI').first().json";
  f.post('Save content', `${P}.api_base + '/api/automation/properties/' + ${P}.property.id + '/ai-content'`, `${P}.save_body`);
  finishWebhook(f, P);
  f.chain('Webhook', 'Build prompt', 'Gemini', 'Parse AI', 'Save content', 'Finish run');
  f.save();
})();

/* ============ 07. Weekly digest ============ */
(() => {
  const f = new Flow('07-weekly-digest.json', 'Plotwise 07 - Weekly digest');
  f.schedule('Monday 09:00', { field: 'weeks', weeksInterval: 1, triggerAtDay: [1], triggerAtHour: 9 });
  f.config();
  f.get('Get digest', `${CFG} + '/api/automation/weekly-digest'`);
  f.code('Build digest', function () {
    const d = $input.first().json; const fmt = (v) => 'PKR ' + Number(v).toLocaleString('en-PK');
    const props = d.properties.map((p) => `<li><b>${p.title}</b> (${p.city}) ${fmt(p.price)}${p.listing_type === 'rent' ? '/mo' : ''}</li>`).join('');
    const deals = d.deals.map((x) => `<li>${x.title}, ${x.city}: ${fmt(x.price)}, <b>${x.price_gap_pct}% below</b> the estimated fair price of ${fmt(x.estimated_price)}</li>`).join('');
    return d.subscribers.map((s) => ({ json: { to: s.email, subject: 'Your weekly property digest', html: `Hi ${s.name},<br><br><b>New listings</b><ul>${props}</ul><b>Bargains this week</b><ul>${deals || '<li>No new bargains.</li>'}</ul>Plotwise team` } }));
  }, false);
  f.gmail('Send digest', '$json.to', '$json.subject', '$json.html');
  logRun(f, 'weekly_digest', ", payload: { recipients: $('Build digest').all().length }");
  f.nodes.find((n) => n.name === 'Log run').executeOnce = true;
  f.chain('Monday 09:00', 'Config', 'Get digest', 'Build digest', 'Send digest', 'Log run');
  f.save();
})();

/* ============ 08. Rent reminders + landlord escalation ============ */
(() => {
  const f = new Flow('08-rent-reminders.json', 'Plotwise 08 - Rent reminders');
  f.schedule('Daily 09:00', { field: 'days', daysInterval: 1, triggerAtHour: 9 });
  f.config();
  f.get('Rent due', `${CFG} + '/api/automation/rent-due'`);
  f.code('Build reminder', function () {
    const r = $json; const amt = 'PKR ' + Number(r.amount).toLocaleString('en-PK'); const od = r.days_overdue;
    const subject = od <= 0 ? `Rent ${od === 0 ? 'due today' : 'due soon'}: ${r.property_title}` : `Overdue rent: ${r.property_title} (${od} days)`;
    const line = od <= 0 ? `This is a reminder that ${amt} for ${r.property_title} is due on ${r.due_date}.` : `Your rent of ${amt} for ${r.property_title} was due on ${r.due_date} and is ${od} day(s) overdue. Please pay as soon as you can, or reply if there is a problem.`;
    return { json: { id: r.id, api_base: $('Config').first().json.api_base, to: r.tenant_email, subject, html: `Hi ${r.tenant_name},<br><br>${line}<br><br>Thank you,<br>Plotwise property management`,
      escalate: od === 7 || od === 14, landlord_to: r.landlord_email, landlord_subject: `Rent overdue at ${r.property_title}`,
      landlord_html: `Hi ${r.landlord_name},<br><br>${r.tenant_name}'s rent of ${amt} for ${r.property_title} is ${od} days overdue. We have sent reminders and will keep following up.<br><br>Plotwise property management` } };
  });
  f.gmail('Remind tenant', '$json.to', '$json.subject', '$json.html');
  const P = "$('Build reminder').item.json";
  f.post('Mark reminded', `${P}.api_base + '/api/automation/rent/' + ${P}.id + '/reminded'`, '{}');
  f.iff('Escalate to landlord?', `${P}.escalate`);
  f.gmail('Notify landlord', `${P}.landlord_to`, `${P}.landlord_subject`, `${P}.landlord_html`);
  f.post('Log run', `${P}.api_base + '/api/automation/runs/log'`, `{ workflow: 'rent_reminder', entity_type: 'rent_payment', entity_id: ${P}.id }`);
  f.chain('Daily 09:00', 'Config', 'Rent due', 'Build reminder', 'Remind tenant', 'Mark reminded', 'Escalate to landlord?');
  f.link('Escalate to landlord?', 'Notify landlord', 0); f.link('Notify landlord', 'Log run'); f.link('Escalate to landlord?', 'Log run', 1);
  f.save();
})();

/* ============ 09. Lease expiry alerts ============ */
(() => {
  const f = new Flow('09-lease-expiry-alerts.json', 'Plotwise 09 - Lease expiry alerts');
  f.schedule('Daily 09:00', { field: 'days', daysInterval: 1, triggerAtHour: 9 });
  f.config();
  f.get('Expiring leases', `${CFG} + '/api/automation/expiring-leases'`);
  f.code('Build emails', function () {
    return $input.all().flatMap((i) => {
      const l = i.json; const subject = `Lease for ${l.property_title} ends in ${l.days_left} days`;
      const tail = `The lease ends on ${l.end_date}. Monthly rent is PKR ${Number(l.monthly_rent).toLocaleString('en-PK')}. Reply to this email to renew, change terms or plan the move-out.<br><br>Plotwise property management`;
      return [
        { json: { to: l.tenant_email, subject, html: `Hi ${l.tenant_name},<br><br>${tail}` } },
        { json: { to: l.landlord_email, subject, html: `Hi ${l.landlord_name},<br><br>Your tenant ${l.tenant_name} is nearing the end of the lease. ${tail}` } },
      ];
    });
  }, false);
  f.gmail('Send alert', '$json.to', '$json.subject', '$json.html');
  logRun(f, 'lease_expiry', ", payload: { emails: $('Build emails').all().length }");
  f.nodes.find((n) => n.name === 'Log run').executeOnce = true;
  f.chain('Daily 09:00', 'Config', 'Expiring leases', 'Build emails', 'Send alert', 'Log run');
  f.save();
})();

/* ============ 10. Maintenance ticket triage ============ */
(() => {
  const f = new Flow('10-maintenance-triage.json', 'Plotwise 10 - Maintenance triage');
  f.webhook('Webhook', 'maintenance-ticket');
  f.code('Build prompt', function () {
    const b = $json.body; const t = b.ticket;
    const prompt = `You triage maintenance requests for rental properties.
Ticket: "${t.title}". Details: "${t.description || ''}". Property: ${b.property.title}.
Return ONLY JSON: {"category":"plumbing|electrical|hvac|carpentry|cleaning|general","urgency":"low|medium|high|emergency","summary":string (max 25 words)}.
Use emergency only for gas smell, fire, flooding, sparks or a total power loss.`;
    return { json: { ...b, gemini_body: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } } } };
  });
  f.gemini();
  f.code('Parse triage', function () {
    const prev = $('Build prompt').item.json;
    let ai = {}; try { ai = JSON.parse($json.candidates[0].content.parts[0].text); } catch (e) { /* fall back below */ }
    const category = ['plumbing', 'electrical', 'hvac', 'carpentry', 'cleaning', 'general'].includes(ai.category) ? ai.category : 'general';
    const urgency = ['low', 'medium', 'high', 'emergency'].includes(ai.urgency) ? ai.urgency : 'medium';
    return { json: { ...prev, triage_body: { category, urgency, ai_summary: ai.summary || prev.ticket.title } } };
  });
  const T = "$('Parse triage').first().json";
  f.post('Save triage', `${T}.api_base + '/api/automation/tickets/' + ${T}.ticket.id + '/triage'`, `${T}.triage_body`);
  f.code('Build notices', function () {
    const t = $json; const ctx = $('Parse triage').first().json; const v = t.vendor;
    return { json: { has_vendor: !!(v && v.email), vendor_to: v && v.email, vendor_subject: `[${t.urgency.toUpperCase()}] ${ctx.ticket.title} at ${ctx.property.title}`,
      vendor_html: `Hi ${v ? v.name : ''},<br><br>New ${t.category} job at <b>${ctx.property.title}</b>${ctx.property.address ? ', ' + ctx.property.address : ''}, ${ctx.property.city}.<br>Problem: ${ctx.ticket.title}. ${ctx.ticket.description || ''}<br>Reported by ${ctx.reporter.name}${ctx.reporter.phone ? ' (' + ctx.reporter.phone + ')' : ''}.<br>Urgency: <b>${t.urgency}</b>.<br><br>Please confirm when you can attend.<br>Plotwise property management`,
      urgent: ['high', 'emergency'].includes(t.urgency), alert_text: `${t.urgency.toUpperCase()} ${t.category} ticket at ${ctx.property.title}: ${ctx.ticket.title}`, chat_id: (ctx.agent && ctx.agent.telegram_chat_id) || 'REPLACE_WITH_CHAT_ID' } };
  });
  const N = "$('Build notices').first().json";
  f.iff('Vendor assigned?', `${N}.has_vendor`);
  f.gmail('Email vendor', `${N}.vendor_to`, `${N}.vendor_subject`, `${N}.vendor_html`);
  f.iff('Urgent?', `${N}.urgent`);
  f.telegram('Alert agent', `${N}.chat_id`, `${N}.alert_text`);
  finishWebhook(f, T);
  f.chain('Webhook', 'Build prompt', 'Gemini', 'Parse triage', 'Save triage', 'Build notices', 'Vendor assigned?');
  f.link('Vendor assigned?', 'Email vendor', 0); f.link('Email vendor', 'Urgent?'); f.link('Vendor assigned?', 'Urgent?', 1);
  f.link('Urgent?', 'Alert agent', 0); f.link('Alert agent', 'Finish run'); f.link('Urgent?', 'Finish run', 1);
  f.save();
})();

/* ============ 11. Monthly owner statements ============ */
(() => {
  const f = new Flow('11-owner-statements.json', 'Plotwise 11 - Owner statements');
  f.schedule('1st of month 08:00', { field: 'months', monthsInterval: 1, triggerAtDayOfMonth: 1, triggerAtHour: 8 });
  f.config();
  f.get('Get statements', `${CFG} + '/api/automation/owner-statements'`);
  f.code('Build statement', function () {
    const s = $json; const fmt = (v) => 'PKR ' + Number(v).toLocaleString('en-PK');
    const rows = s.items.map((i) => `<tr><td>${i.property}</td><td align="right">${fmt(i.amount)}</td></tr>`).join('');
    return { json: { ...s, api_base: $('Config').first().json.api_base, subject: `Your rent statement for ${s.period}`,
      html: `Hi ${s.landlord_name},<br><br>Here is your rent summary for <b>${s.period}</b>.<br><br><table cellpadding="6" border="1" style="border-collapse:collapse"><tr><th align="left">Property</th><th>Collected</th></tr>${rows}<tr><td><b>Total</b></td><td align="right"><b>${fmt(s.rent_collected)}</b></td></tr></table>${s.tickets ? '<br>Maintenance tickets opened this month: ' + s.tickets + '.' : ''}<br><br>Plotwise property management` } };
  });
  f.gmail('Email statement', '$json.landlord_email', '$json.subject', '$json.html');
  const P = "$('Build statement').item.json";
  f.post('Record statement', `${P}.api_base + '/api/automation/owner-statements'`, `{ landlord_id: ${P}.landlord_id, period: ${P}.period, rent_collected: ${P}.rent_collected, expenses: 0 }`);
  f.post('Log run', `${P}.api_base + '/api/automation/runs/log'`, `{ workflow: 'owner_statement', entity_type: 'landlord', entity_id: ${P}.landlord_id }`);
  f.chain('1st of month 08:00', 'Config', 'Get statements', 'Build statement', 'Email statement', 'Record statement', 'Log run');
  f.save();
})();

/* ============ 12. Deal alerts ============ */
(() => {
  const f = new Flow('12-deal-alerts.json', 'Plotwise 12 - Deal alerts');
  f.webhook('Webhook', 'deal-alert');
  f.code('Build alert', function () {
    const b = $json.body; const l = b.listing; const f2 = (v) => 'PKR ' + Number(v).toLocaleString('en-PK');
    const text = `New deal for "${b.search_name}": ${l.title}, ${l.city}. Asking ${f2(l.price)}, ${l.price_gap_pct}% below the estimated fair price of ${f2(l.estimated_price)}.`;
    return { json: { ...b, text, subject: `Deal alert: ${l.title} is ${l.price_gap_pct}% below fair price`, html: `Hi ${b.user.name},<br><br>${text}<br><br>Log in to Plotwise to see it in the deal finder.`, use_telegram: b.channel === 'telegram' && !!b.user.telegram_chat_id } };
  });
  f.iff('Send by Telegram?', '$json.use_telegram');
  f.telegram('Telegram alert', '$json.user.telegram_chat_id', '$json.text');
  f.gmail('Email alert', '$json.user.email', '$json.subject', '$json.html');
  const P = "$('Build alert').first().json";
  f.post('Mark alert sent', `${P}.api_base + '/api/automation/alerts/' + ${P}.alert_id + '/sent'`, '{}');
  finishWebhook(f, P);
  f.chain('Webhook', 'Build alert', 'Send by Telegram?');
  f.link('Send by Telegram?', 'Telegram alert', 0); f.link('Send by Telegram?', 'Email alert', 1);
  f.link('Telegram alert', 'Mark alert sent'); f.link('Email alert', 'Mark alert sent'); f.link('Mark alert sent', 'Finish run');
  f.save();
})();

console.log('Wrote', fs.readdirSync(OUT).length, 'workflows to n8n/workflows');
