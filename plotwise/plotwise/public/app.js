/* Plotwise front end: plain JS, hash router, no build step. */
const S = { token: localStorage.getItem('pw_token'), user: JSON.parse(localStorage.getItem('pw_user') || 'null'), timer: null, map: null };
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STAFF = ['admin', 'agent'];
const isStaff = () => S.user && STAFF.includes(S.user.role);
const trim = (x) => String(+x.toFixed(2));
const price = (v, type) => {
  v = Number(v);
  const s = v >= 1e7 ? trim(v / 1e7) + ' Cr' : v >= 1e5 ? trim(v / 1e5) + ' Lakh' : v.toLocaleString('en-PK');
  return 'PKR ' + s + (type === 'rent' ? ' /mo' : '');
};
const dt = (s) => {
  if (!s) return '–';
  const [d, t] = String(s).split(' ');
  const [, m, dd] = d.split('-');
  return `${+dd} ${MON[m - 1]}${t ? ', ' + t.slice(0, 5) : ''}`;
};
const label = (s) => String(s || '').replace(/_/g, ' ');

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) { logout(true); throw new Error(j.error || 'Session expired'); }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}
const fail = (e) => toast(e.message, true);
function setUser(token, user) {
  S.token = token; S.user = user;
  localStorage.setItem('pw_token', token); localStorage.setItem('pw_user', JSON.stringify(user));
}
function logout(expired) {
  S.token = null; S.user = null;
  localStorage.removeItem('pw_token'); localStorage.removeItem('pw_user');
  location.hash = '#/login';
  if (expired) toast('Session expired. Log in again', true);
}
const pill = (t, c = '') => `<span class="pill ${c}">${esc(label(t))}</span>`;
const STATUS_COLOR = { new: 'blue', contacted: 'amber', viewing_booked: 'brass', negotiation: 'brass', won: 'green', lost: '', scheduled: 'blue', completed: 'green', cancelled: '', no_show: 'red', active: 'green', expiring: 'amber', ended: '', paid: 'green', pending: 'amber', overdue: 'red', open: 'red', assigned: 'blue', in_progress: 'amber', resolved: 'green', closed: '', success: 'green', failed: 'red', running: 'amber', skipped: '', draft: '', managed: 'blue', emergency: 'red', high: 'red', medium: 'amber', low: '' };
const status = (s) => pill(s, STATUS_COLOR[s] || '');
const scorePill = (l) => `<span class="score ${l.score_label || 'none'}">${l.score ?? '–'}</span>`;

/* ---------- overlays ---------- */
function overlay(html, { drawer = false } = {}) {
  closeOverlay();
  const el = document.createElement('div');
  el.className = 'shade' + (drawer ? '' : ' center');
  el.innerHTML = `<div class="${drawer ? 'drawer' : 'modal'}" role="dialog" aria-modal="true"><button class="close" data-act="close" aria-label="Close">&times;</button>${html}</div>`;
  el.addEventListener('mousedown', (e) => { if (e.target === el) closeOverlay(); });
  $('#layer').append(el);
  return el;
}
function closeOverlay() { $('#layer').innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(); });

/* ---------- header ---------- */
const MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="9" height="9" fill="#f0c66b"/><rect x="13" y="2" width="9" height="9" fill="none" stroke="#fff" stroke-width="1.5"/><rect x="2" y="13" width="9" height="9" fill="none" stroke="#fff" stroke-width="1.5"/><rect x="13" y="13" width="9" height="9" fill="none" stroke="#fff" stroke-width="1.5"/></svg>';
function header(route) {
  const dashHash = S.user ? '#/dash/' + defaultTab() : '#/login';
  $('#top').innerHTML = `<a class="brand" href="#/">${MARK}Plotwise</a>
    <nav><a href="#/" class="${route[0] === '' || route[0] === 'property' ? 'on' : ''}">Browse</a>${S.user ? `<a href="${dashHash}" class="${route[0] === 'dash' ? 'on' : ''}">Dashboard</a>` : ''}</nav>
    <div class="who">${S.user ? `<span>${esc(S.user.name)} <span class="pill brass">${esc(S.user.role)}</span></span><button class="btn ghost sm" data-act="logout">Log out</button>` : '<a class="btn ghost sm" href="#/login">Log in</a>'}</div>`;
}

/* ---------- router ---------- */
async function render() {
  clearInterval(S.timer);
  closeOverlay();
  const route = location.hash.replace(/^#\/?/, '').split('/');
  header(route);
  const app = $('#app');
  app.innerHTML = '<div class="load">Loading…</div>';
  try {
    if (route[0] === 'property') await viewProperty(route[1]);
    else if (route[0] === 'login') viewLogin();
    else if (route[0] === 'dash') {
      if (!S.user) { location.hash = '#/login'; return; }
      await viewDash(route[1] || defaultTab());
    } else await viewBrowse();
  } catch (e) { app.innerHTML = `<div class="load">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', render);

/* ---------- browse ---------- */
const F = { q: '', city: '', listing_type: '', beds: '', sort: '' };
async function viewBrowse() {
  const cities = await api('/properties/meta/cities');
  $('#app').innerHTML = `
    <form class="filters" id="filters">
      <div class="grow"><label for="fq">Search</label><input id="fq" name="q" placeholder="Area, street or title" value="${esc(F.q)}"></div>
      <div><label>For</label><div class="seg" id="seg">${[['', 'All'], ['sale', 'Buy'], ['rent', 'Rent']].map(([v, t]) => `<button type="button" data-lt="${v}" class="${F.listing_type === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>
      <div><label for="fc">City</label><select id="fc" name="city"><option value="">Any city</option>${cities.map((c) => `<option ${F.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div><label for="fb">Bedrooms</label><select id="fb" name="beds">${['', 1, 2, 3, 4].map((b) => `<option value="${b}" ${String(F.beds) === String(b) ? 'selected' : ''}>${b ? b + '+' : 'Any'}</option>`).join('')}</select></div>
      <div><label for="fs">Sort</label><select id="fs" name="sort">${[['', 'Newest'], ['price_asc', 'Price, low to high'], ['price_desc', 'Price, high to low']].map(([v, t]) => `<option value="${v}" ${F.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    </form>
    <div class="browse"><div class="cards" id="cards"></div><div id="map" role="region" aria-label="Map of listings"></div></div>`;
  S.map = null;
  await loadListings();
}
async function loadListings() {
  const qs = new URLSearchParams(Object.entries(F).filter(([, v]) => v)).toString();
  const rows = await api('/properties?' + qs);
  const box = $('#cards');
  if (!box) return;
  box.innerHTML = rows.length ? rows.map((p) => `
    <article class="listing" data-act="open" data-id="${p.id}" tabindex="0">
      <div class="ph">${p.cover ? `<img src="${esc(p.cover)}" alt="${esc(p.title)}" loading="lazy">` : ''}<span class="tag">${price(p.price, p.listing_type)}</span></div>
      <div class="b"><h3>${esc(p.title)}</h3><div class="meta"><span>${esc(p.city)}</span>${p.bedrooms ? `<span>${p.bedrooms} bed</span>` : ''}${p.bathrooms ? `<span>${p.bathrooms} bath</span>` : ''}${p.area_sqft ? `<span>${p.area_sqft.toLocaleString()} sq ft</span>` : ''}</div></div>
    </article>`).join('') : '<div class="empty">No listings match these filters. Clear a filter or pick another city.</div>';
  drawMap(rows);
}
function drawMap(rows) {
  if (!window.L || !$('#map')) return;
  if (!S.map) {
    S.map = L.map('map', { scrollWheelZoom: false }).setView([30.2, 70.5], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 18 }).addTo(S.map);
    S.markers = L.layerGroup().addTo(S.map);
  }
  S.markers.clearLayers();
  const pts = [];
  rows.filter((p) => p.lat && p.lng).forEach((p) => {
    const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="pin">${price(p.price, p.listing_type).replace('PKR ', '')}</div>`, iconSize: null }) });
    m.on('click', () => { location.hash = '#/property/' + p.id; });
    m.addTo(S.markers); pts.push([p.lat, p.lng]);
  });
  if (pts.length) S.map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
}

/* ---------- property page ---------- */
async function viewProperty(id) {
  const p = await api('/properties/' + id);
  const imgs = p.images.length ? p.images.map((i) => i.url) : [];
  const text = p.ai_description || p.description || '';
  $('#app').innerHTML = `<div class="detail"><div>
      <div class="gallery">${imgs.length ? `<img class="big" id="big" src="${esc(imgs[0])}" alt="${esc(p.title)}"><div class="thumbs">${imgs.map((u, i) => `<img src="${esc(u)}" data-act="thumb" data-u="${esc(u)}" class="${i ? '' : 'on'}" alt="Photo ${i + 1}">`).join('')}</div>` : ''}</div>
      <h1>${esc(p.title)}</h1><div class="price">${price(p.price, p.listing_type)}</div>
      <div class="meta"><span>${esc(p.address || '')}, ${esc(p.city || '')}</span>${p.bedrooms ? `<span>${p.bedrooms} bed</span>` : ''}${p.bathrooms ? `<span>${p.bathrooms} bath</span>` : ''}${p.area_sqft ? `<span>${p.area_sqft.toLocaleString()} sq ft</span>` : ''}<span>${label(p.property_type)}</span></div>
      <p class="desc">${esc(text)}${p.ai_description ? '<span class="chip">written by the listing assistant</span>' : ''}</p>
      ${p.agent_name ? `<p class="muted">Listed by ${esc(p.agent_name)}</p>` : ''}
    </div>
    <aside class="sticky panel"><div class="tabs"><button class="on" data-act="ptab" data-t="inq">Ask a question</button><button data-act="ptab" data-t="book">Book a viewing</button></div>
      <div id="pbox"></div></aside></div>`;
  S.prop = p; showPanel('inq');
}
function showPanel(t) {
  const p = S.prop, u = S.user || {};
  $('#pbox').innerHTML = t === 'inq' ? `
    <form data-form="inquiry"><input type="hidden" name="property_id" value="${p.id}">
      <div class="row"><div><label>Name</label><input name="name" required value="${esc(u.name || '')}"></div></div>
      <div class="row two"><div><label>Email</label><input name="email" type="email" value="${esc(u.email || '')}"></div><div><label>Phone</label><input name="phone" placeholder="+92 3xx xxxxxxx"></div></div>
      <div class="row"><div><label>Budget (PKR)</label><input name="budget" type="number" min="0" step="1000"></div></div>
      <div class="row"><div><label>Message</label><textarea name="message" placeholder="Is this still available? When can I visit?"></textarea></div></div>
      <div class="err" id="ferr"></div><button class="btn" style="width:100%">Send inquiry</button></form>` : `
    <form data-form="booking"><input type="hidden" name="property_id" value="${p.id}"><input type="hidden" name="slot" id="slot">
      <div class="row"><div><label>Date</label><input type="date" name="date" id="bdate" min="${new Date().toISOString().slice(0, 10)}" required></div></div>
      <label>Time</label><div class="slots" id="slots"><span class="muted small">Pick a date to see free times.</span></div>
      <div class="row"><div><label>Name</label><input name="name" required value="${esc(u.name || '')}"></div></div>
      <div class="row two"><div><label>Email</label><input name="email" type="email" value="${esc(u.email || '')}"></div><div><label>Phone</label><input name="phone"></div></div>
      <div class="err" id="ferr"></div><button class="btn" style="width:100%">Book viewing</button></form>`;
}
async function loadSlots(date) {
  const box = $('#slots');
  try {
    const s = await api(`/viewings/availability?property_id=${S.prop.id}&date=${date}`);
    $('#slot').value = '';
    box.innerHTML = s.length ? s.map((t) => `<button type="button" data-act="slot" data-t="${t}">${t}</button>`).join('') : '<span class="muted small">No free times that day. Try another date.</span>';
  } catch (e) { box.textContent = e.message; }
}

/* ---------- login ---------- */
const DEMOS = [['admin@plotwise.demo', 'Admin', 'everything'], ['agent@plotwise.demo', 'Agent', 'CRM, deals, automations'], ['landlord@plotwise.demo', 'Landlord', 'own properties'], ['tenant@plotwise.demo', 'Tenant', 'rent and tickets'], ['buyer@plotwise.demo', 'Investor', 'deal finder']];
function viewLogin() {
  $('#app').innerHTML = `<div class="auth"><h1>Log in</h1><p class="muted">Use a demo account to see each role.</p>
    <form data-form="login"><div class="row"><div><label>Email</label><input name="email" type="email" required autocomplete="username"></div></div>
    <div class="row"><div><label>Password</label><input name="password" type="password" required autocomplete="current-password"></div></div>
    <div class="err" id="ferr"></div><button class="btn" style="width:100%">Log in</button></form>
    <div class="demo"><h3 style="margin-bottom:10px">Demo accounts <span class="muted small">(password: demo1234)</span></h3>
    ${DEMOS.map(([e, n, d]) => `<button data-act="demo" data-e="${e}"><b>${n}</b><span class="muted small">${d}</span></button>`).join('')}</div></div>`;
}

/* ======================= dashboard ======================= */
const TABS = {
  staff: [['overview', 'Overview'], ['leads', 'Leads'], ['viewings', 'Viewings'], ['listings', 'Listings'], ['deals', 'Deal finder'], ['management', 'Property management'], ['automations', 'Automations']],
  landlord: [['management', 'My properties']], tenant: [['management', 'My tenancy']], buyer: [['deals', 'Deal finder']],
};
const tabsFor = () => TABS[isStaff() ? 'staff' : S.user.role] || TABS.buyer;
const defaultTab = () => tabsFor()[0][0];
const views = {};
async function viewDash(tab) {
  const tabs = tabsFor();
  if (!tabs.find((t) => t[0] === tab)) tab = tabs[0][0];
  S.tab = tab;
  $('#app').innerHTML = `<div class="dash"><nav class="side"><div class="role">Signed in as ${esc(S.user.role)}</div>${tabs.map(([k, t]) => `<a href="#/dash/${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</nav><section class="main" id="main"><div class="load">Loading…</div></section></div>`;
  await views[tab]($('#main'));
}
const head = (title, extra = '') => `<div class="head"><h2>${title}</h2><span class="sp"></span>${extra}</div>`;
const tbl = (cols, rows, click) => `<div class="tablewrap"><table><thead><tr>${cols.map((c) => `<th class="${c[2] || ''}">${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr ${click ? `class="click" data-act="${click}" data-id="${r.id}"` : ''}>${cols.map((c) => `<td class="${c[2] || ''}">${c[1](r)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="muted">Nothing here yet.</td></tr>`}</tbody></table></div>`;
const bars = (rows, max) => `<div class="bars">${rows.map(([k, n]) => `<div class="r"><span>${esc(label(k))}</span><div class="t"><i style="width:${(n / max) * 100}%"></i></div><b>${n}</b></div>`).join('')}</div>`;
const J = (v) => (typeof v === 'string' ? JSON.parse(v) : v || {});

/* ---- overview ---- */
views.overview = async (m) => {
  const d = await api('/analytics/summary');
  const c = d.counts, r = d.response, rent = d.rent, ls = d.lease, runs = d.runs;
  const sec = r.avg_sec == null ? '–' : r.avg_sec < 120 ? Math.round(r.avg_sec) + ' s' : Math.round(r.avg_sec / 60) + ' min';
  const order = ['new', 'contacted', 'viewing_booked', 'negotiation', 'won', 'lost'];
  const fun = order.map((s) => [s, (d.funnel.find((x) => x.status === s) || { n: 0 }).n]);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const x = new Date(Date.now() - i * 864e5);
    const k = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    days.push((d.perDay.find((p) => p.d === k) || { n: 0 }).n);
  }
  const pm = Math.max(1, ...days);
  const pts = days.map((n, i) => `${((i * 300) / 13).toFixed(1)},${(46 - (n / pm) * 40).toFixed(1)}`).join(' ');
  m.innerHTML = head('Overview') + `
    <div class="stats">
      <div class="stat hero"><b>${sec}</b><span>Average time from inquiry to reply, across ${r.n || 0} leads</span></div>
      <div class="stat"><b>${c.hot_open}</b><span>Hot leads open</span></div>
      <div class="stat"><b>${c.deals}</b><span>Undervalued deals found</span></div>
      <div class="stat"><b>${rent.overdue_count || 0}</b><span>Overdue rent, ${price(rent.overdue_amount || 0)}</span></div>
      <div class="stat"><b>${runs.total ? Math.round((100 * runs.ok) / runs.total) + '%' : '–'}</b><span>Automations succeeded, last 30 days</span></div>
    </div>
    <div class="grid2">
      <div class="box"><h3>Lead funnel</h3>${bars(fun, Math.max(1, ...fun.map((x) => x[1])))}</div>
      <div class="box"><h3>Leads by source</h3>${bars(d.bySource.map((x) => [x.source, x.n]), Math.max(1, ...d.bySource.map((x) => x.n)))}
        <h3 style="margin:16px 0 6px">Leads per day, last 14 days</h3><svg viewBox="0 0 300 50" width="100%" height="56" role="img" aria-label="Leads per day"><polyline points="${pts}" fill="none" stroke="#0f5c4d" stroke-width="2"/></svg></div>
    </div>
    <div class="grid2">
      <div class="box"><h3>Listing performance</h3>${tbl([['Listing', (x) => esc(x.title)], ['Leads', (x) => x.leads, 'right'], ['Progressed', (x) => x.progressed || 0, 'right'], ['Viewings', (x) => x.viewings, 'right']], d.topListings)}</div>
      <div class="box"><h3>Portfolio</h3>
        <p><b>${c.listings}</b> active listings, <b>${ls.active || 0}</b> active leases, <b>${ls.expiring_90 || 0}</b> ending within 90 days.</p>
        <p>Rent collected this month: <b>${price(rent.collected_month)}</b>. Open maintenance tickets: <b>${c.open_tickets}</b>.</p></div>
    </div>
    <div class="box"><h3>Automations by workflow</h3>${tbl([['Workflow', (x) => esc(label(x.workflow))], ['Runs', (x) => x.n, 'right'], ['Succeeded', (x) => x.ok, 'right'], ['Failed', (x) => (x.failed ? `<span class="pill red">${x.failed}</span>` : 0), 'right'], ['Avg time', (x) => (x.avg_ms ? (x.avg_ms / 1000).toFixed(1) + ' s' : '–'), 'right']], d.byWorkflow)}</div>`;
};

/* ---- leads ---- */
const LF = { status: '', label: '', q: '' };
views.leads = async (m) => {
  const qs = new URLSearchParams(Object.entries(LF).filter(([, v]) => v)).toString();
  const rows = await api('/leads?' + qs);
  const chip = (k, v, t) => `<button data-act="lfilter" data-k="${k}" data-v="${v}" class="${LF[k] === v ? 'on' : ''}">${t}</button>`;
  m.innerHTML = head('Leads', `<form data-form="leadsearch" style="width:240px"><input name="q" placeholder="Search name, email, phone" value="${esc(LF.q)}" aria-label="Search leads"></form>`) +
    `<div class="chips" style="margin-bottom:10px">${chip('status', '', 'All')}${['new', 'contacted', 'viewing_booked', 'negotiation', 'won', 'lost'].map((s) => chip('status', s, label(s))).join('')}</div>
     <div class="chips" style="margin-bottom:16px">${chip('label', '', 'Any score')}${['hot', 'warm', 'cold'].map((s) => chip('label', s, s)).join('')}</div>` +
    tbl([['Score', scorePill], ['Lead', (l) => `<b>${esc(l.name)}</b><div class="muted small">${esc(l.email || l.phone || '')}</div>`], ['Property', (l) => esc(l.property_title || 'General')], ['Source', (l) => label(l.source)], ['Status', (l) => status(l.status)], ['Agent', (l) => esc(l.agent_name || '–')], ['Received', (l) => dt(l.created_at), 'nowrap']], rows, 'lead');
};
const ACT = {
  created: (d) => `Inquiry received from ${label(d.source)}`,
  scored: (d) => `Scored ${d.score} (${d.label}). ${d.reason || ''}`,
  ai_reply_sent: (d) => `Reply sent by ${d.channel}`,
  followup_sent: (d) => `Follow-up ${d.step} sent`,
  viewing_booked: (d) => `Viewing booked for ${dt(d.scheduled_at)}`,
  status_change: (d) => `Status changed from ${label(d.from)} to ${label(d.to)}${d.by ? ' by ' + d.by : ''}`,
  assigned: (d) => `Reassigned${d.by ? ' by ' + d.by : ''}`,
  note: (d) => `Note from ${d.by}: ${d.text}`,
  lease_created: (d) => `Lease #${d.lease_id} created`,
};
const secs = (a, b) => Math.round((new Date(b.replace(' ', 'T')) - new Date(a.replace(' ', 'T'))) / 1000);
async function openLead(id) {
  const l = await api('/leads/' + id);
  const reply = l.activities.find((a) => a.type === 'ai_reply_sent');
  const rs = reply ? secs(l.created_at, reply.created_at) : null;
  const el = overlay(`
    <h2>${esc(l.name)}</h2><div class="muted">${esc([l.email, l.phone].filter(Boolean).join(' · '))}</div>
    <div class="reply"><b>${rs == null ? '–' : rs < 120 ? rs + ' s' : Math.round(rs / 60) + ' min'}</b><span>${rs == null ? 'No reply yet. The automation has not finished.' : 'from inquiry to the first reply, sent by automation'}</span></div>
    <p>${scorePill(l)} <b>${esc(l.score_label || 'unscored')}</b> <span class="muted">${esc(l.score_reason || '')}</span></p>
    <p class="muted small">${esc(l.property_title || 'General inquiry')} ${l.budget ? '· budget ' + price(l.budget) : ''} · assigned to ${esc(l.agent_name || 'nobody')}</p>
    ${l.message ? `<div class="msg">${esc(l.message)}</div>` : ''}
    <div class="row two" style="margin-top:14px"><div><label>Status</label><select id="lstatus">${['new', 'contacted', 'viewing_booked', 'negotiation', 'won', 'lost'].map((s) => `<option value="${s}" ${l.status === s ? 'selected' : ''}>${label(s)}</option>`).join('')}</select></div>
      <div style="align-self:end"><button class="btn" data-act="leadStatus" data-id="${l.id}">Save status</button></div></div>
    <h3 style="margin:18px 0 4px">Timeline</h3>
    <ul class="timeline">${l.activities.map((a) => `<li class="${a.type.startsWith('ai') || a.type === 'scored' || a.type === 'followup_sent' ? 'ai' : ''}">${esc((ACT[a.type] || (() => a.type))(J(a.details)))}<div class="when">${dt(a.created_at)}</div></li>`).join('')}</ul>
    ${l.messages.length ? `<h3 style="margin:8px 0">Messages</h3>${l.messages.map((x) => `<div class="msg"><b>${esc(x.subject || x.channel)}</b>${esc(x.body)}<div class="muted small" style="margin-top:6px">${label(x.channel)} · ${x.generated_by === 'ai' ? 'written by AI' : x.generated_by} · ${label(x.status)}</div></div>`).join('')}` : ''}
    ${l.viewings.length ? `<h3 style="margin:8px 0">Viewings</h3>${l.viewings.map((v) => `<p>${dt(v.scheduled_at)} ${status(v.status)}</p>`).join('')}` : ''}
    <form data-form="note" style="margin-top:14px"><input type="hidden" name="id" value="${l.id}"><label>Add a note</label><textarea name="note" required></textarea><div class="err" id="ferr"></div><button class="btn ghost sm">Add note</button>
      ${l.email && l.status !== 'won' ? `<button type="button" class="btn brass sm" data-act="newLease" data-lead="${l.id}" data-prop="${l.property_id || ''}">Create lease</button>` : ''}</form>`, { drawer: true });
  return el;
}

/* ---- viewings ---- */
views.viewings = async (m) => {
  const rows = await api('/viewings');
  m.innerHTML = head('Viewings') + tbl([['When', (v) => dt(v.scheduled_at), 'nowrap'], ['Lead', (v) => `<b>${esc(v.lead_name)}</b><div class="muted small">${esc(v.lead_email || v.lead_phone || '')}</div>`], ['Property', (v) => esc(v.property_title)], ['Agent', (v) => esc(v.agent_name || '–')], ['Status', (v) => status(v.status)],
    ['', (v) => (v.status === 'scheduled' ? `<button class="btn sm" data-act="vset" data-s="completed" data-id="${v.id}">Completed</button> <button class="btn ghost sm" data-act="vset" data-s="no_show" data-id="${v.id}">No show</button> <button class="btn ghost sm" data-act="vset" data-s="cancelled" data-id="${v.id}">Cancel</button>` : ''), 'nowrap']], rows);
};

/* ---- listings ---- */
views.listings = async (m) => {
  const rows = await api('/properties?all=1');
  m.innerHTML = head('Listings', '<button class="btn" data-act="newListing">Add listing</button>') +
    tbl([['', (p) => (p.cover ? `<img src="${esc(p.cover)}" alt="" width="64" height="44" style="object-fit:cover;display:block">` : '')], ['Listing', (p) => `<a href="#/property/${p.id}"><b>${esc(p.title)}</b></a><div class="muted small">${esc(p.city || '')}</div>`], ['Type', (p) => label(p.listing_type) + ' · ' + label(p.property_type)], ['Price', (p) => price(p.price, p.listing_type), 'nowrap'], ['Status', (p) => status(p.status)], ['Source', (p) => label(p.source)], ['Description', (p) => (p.ai_description ? '<span class="pill brass">AI written</span>' : '')]], rows);
};

/* ---- deal finder ---- */
const DF = { city: '', listing_type: '', undervalued: '1' };
views.deals = async (m) => {
  const qs = new URLSearchParams(Object.entries(DF).filter(([, v]) => v)).toString();
  const [rows, searches, alerts] = await Promise.all([api('/deals?' + qs), api('/deals/saved-searches'), api('/deals/alerts')]);
  const chip = (k, v, t) => `<button data-act="dfilter" data-k="${k}" data-v="${v}" class="${DF[k] === v ? 'on' : ''}">${t}</button>`;
  m.innerHTML = head('Deal finder', `${isStaff() ? '<button class="btn ghost" data-act="importSample">Load sample market data</button>' : ''}<button class="btn" data-act="newSearch">Save a search</button>`) +
    `<p class="muted" style="max-width:70ch">Each listing is compared with the median price per sq ft of similar listings in the same city. Listings 15% or more below that fair price are flagged as undervalued.</p>
     <div class="chips" style="margin-bottom:16px">${chip('undervalued', '1', 'Undervalued only')}${chip('undervalued', '', 'All listings')}${chip('listing_type', '', 'Buy and rent')}${chip('listing_type', 'sale', 'Buy')}${chip('listing_type', 'rent', 'Rent')}${['Islamabad', 'Lahore', 'Karachi'].map((c) => chip('city', DF.city === c ? '' : c, c)).join('')}</div>` +
    tbl([['Listing', (d) => `<b>${esc(d.title)}</b><div class="muted small">${esc(d.area_name || '')}, ${esc(d.city || '')}</div>`], ['Type', (d) => label(d.listing_type)], ['Asking', (d) => price(d.price, d.listing_type), 'nowrap'], ['Fair price', (d) => (d.estimated_price ? price(d.estimated_price, d.listing_type) : '–'), 'nowrap'],
      ['Below fair price', (d) => `<div class="gap"><i class="${d.is_undervalued ? '' : 'low'}" style="width:${Math.max(2, Math.min(60, d.price_gap_pct || 0))}px"></i>${d.price_gap_pct ?? '–'}%</div>`],
      ['', (d) => (!isStaff() ? '' : d.promoted_property_id ? `<a class="btn ghost sm" href="#/property/${d.promoted_property_id}">Listed</a>` : `<button class="btn sm" data-act="promote" data-id="${d.id}">Create listing</button>`)]], rows) +
    `<div class="grid2"><div class="box"><h3>Your saved searches</h3>${searches.length ? searches.map((s) => `<p><b>${esc(s.name)}</b> <span class="muted small">${esc(Object.entries(s.filters || {}).map(([k, v]) => label(k) + ' ' + v).join(', ') || 'everything')} · ${s.frequency} by ${s.channel}</span> <button class="btn ghost sm" data-act="delSearch" data-id="${s.id}">Delete</button></p>`).join('') : '<p class="muted">None yet. Save a search and the alert workflow emails you when a matching bargain appears.</p>'}</div>
     <div class="box"><h3>Recent alerts</h3>${alerts.length ? alerts.map((a) => `<p>${esc(a.title)} <span class="muted small">${a.price_gap_pct}% below fair price · ${esc(a.search_name)} · ${a.sent_at ? 'sent ' + dt(a.sent_at) : 'queued'}</span></p>`).join('') : '<p class="muted">No alerts yet.</p>'}</div></div>`;
};

/* ---- property management ---- */
views.management = async (m) => {
  const [leases, rent, tickets] = await Promise.all([api('/management/leases'), api('/management/rent'), api('/management/tickets')]);
  m.innerHTML = head(S.user.role === 'tenant' ? 'My tenancy' : 'Property management', `${isStaff() ? '<button class="btn ghost" data-act="newLease">New lease</button>' : ''}<button class="btn" data-act="newTicket">Report a problem</button>`) +
    '<h3 style="margin-bottom:8px">Leases</h3>' + tbl([['Property', (l) => `<b>${esc(l.property_title)}</b>`], ['Tenant', (l) => esc(l.tenant_name)], ['Landlord', (l) => esc(l.landlord_name)], ['Rent', (l) => price(l.monthly_rent, 'rent'), 'nowrap'], ['Term', (l) => `${dt(l.start_date)} to ${dt(l.end_date)}`, 'nowrap'], ['Left', (l) => (l.days_left >= 0 ? l.days_left + ' days' : 'ended'), 'nowrap'], ['Status', (l) => status(l.status)]], leases) +
    '<h3 style="margin-bottom:8px">Rent</h3>' + tbl([['Due', (r) => dt(r.due_date), 'nowrap'], ['Property', (r) => esc(r.property_title)], ['Tenant', (r) => esc(r.tenant_name)], ['Amount', (r) => price(r.amount), 'nowrap'], ['Status', (r) => status(r.status)], ['Reminders', (r) => r.reminders_sent],
      ['', (r) => (isStaff() && r.status !== 'paid' ? `<button class="btn sm" data-act="paid" data-id="${r.id}">Mark paid</button>` : r.paid_at ? `<span class="muted small">paid ${dt(r.paid_at)}</span>` : '')]], rent.slice(0, 14)) +
    '<h3 style="margin-bottom:8px">Maintenance tickets</h3>' + tbl([['Problem', (t) => `<b>${esc(t.title)}</b><div class="muted small">${esc(t.ai_summary || t.description || '')}</div>`], ['Property', (t) => esc(t.property_title)], ['Category', (t) => label(t.category || 'triage pending')], ['Urgency', (t) => (t.urgency ? status(t.urgency) : '–')], ['Vendor', (t) => esc(t.vendor_name || '–')],
      ['Status', (t) => (isStaff() ? `<select data-change="ticketStatus" data-id="${t.id}" aria-label="Ticket status">${['open', 'assigned', 'in_progress', 'resolved', 'closed'].map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${label(s)}</option>`).join('')}</select>` : status(t.status))]], tickets);
};

/* ---- automations ---- */
views.automations = async (m) => {
  const draw = async () => {
    const d = await api('/automations/runs');
    if (S.tab !== 'automations' || !$('#runs')) return;
    $('#runs').innerHTML = tbl([['Run', (r) => '#' + r.id], ['Workflow', (r) => `<b>${esc(label(r.workflow))}</b>`], ['Trigger', (r) => label(r.trigger_type)], ['For', (r) => (r.entity_type ? `${r.entity_type} ${r.entity_id}` : '–')], ['Status', (r) => status(r.status) + (r.error ? `<div class="small muted">${esc(r.error)}</div>` : '')], ['Time', (r) => (r.duration_ms != null ? (r.duration_ms / 1000).toFixed(1) + ' s' : '…'), 'right'], ['Started', (r) => dt(r.started_at), 'nowrap']], d.runs);
    $('#mode').className = 'mode ' + d.mode;
    $('#mode').textContent = d.mode === 'n8n' ? 'Connected to n8n. Runs below are executed by your n8n workflows.' : 'Local demo mode. Lead and ticket automations use built-in rules. Set N8N_WEBHOOK_BASE to run the real n8n workflows.';
    if (!$('#wf').innerHTML) $('#wf').innerHTML = d.workflows.map((w) => `<div><b>${esc(w.name)}</b><small>${esc(w.trigger)}</small><p class="small" style="margin:6px 0 0">${esc(w.does)}</p></div>`).join('');
  };
  m.innerHTML = head('Automations', '<button class="btn brass" data-act="simulate">Simulate a new lead</button>') + '<div id="mode" class="mode"></div><div id="runs"></div><h3 style="margin:8px 0 10px">Workflows</h3><div class="wf" id="wf"></div>';
  await draw();
  S.timer = setInterval(() => draw().catch(() => {}), 3000);
};

/* ======================= modals ======================= */
const fd = (f) => Object.fromEntries([...new FormData(f)].filter(([, v]) => v !== ''));
const opts = (rows, v, t, sel) => rows.map((r) => `<option value="${r[v]}" ${String(sel) === String(r[v]) ? 'selected' : ''}>${esc(typeof t === 'function' ? t(r) : r[t])}</option>`).join('');

async function modalListing() {
  const landlords = await api('/landlords');
  overlay(`<h2>Add listing</h2><p class="muted small">Saving a listing starts the content workflow, which writes a description and social posts.</p>
    <form data-form="listing"><div class="row"><div><label>Title</label><input name="title" required></div></div>
    <div class="row three"><div><label>For</label><select name="listing_type"><option value="sale">Sale</option><option value="rent">Rent</option></select></div><div><label>Type</label><select name="property_type">${['house', 'apartment', 'plot', 'commercial'].map((t) => `<option>${t}</option>`).join('')}</select></div><div><label>Price (PKR)</label><input name="price" type="number" required min="0"></div></div>
    <div class="row three"><div><label>Bedrooms</label><input name="bedrooms" type="number" min="0"></div><div><label>Bathrooms</label><input name="bathrooms" type="number" min="0"></div><div><label>Area (sq ft)</label><input name="area_sqft" type="number" min="0"></div></div>
    <div class="row two"><div><label>City</label><input name="city" required></div><div><label>Address</label><input name="address"></div></div>
    <div class="row three"><div><label>Latitude</label><input name="lat" type="number" step="any"></div><div><label>Longitude</label><input name="lng" type="number" step="any"></div><div><label>Owner</label><select name="owner_id"><option value="">None</option>${opts(landlords, 'id', 'name')}</select></div></div>
    <div class="row"><div><label>Image URLs, one per line</label><textarea name="images"></textarea></div></div>
    <div class="row"><div><label>Notes for the description writer</label><textarea name="description"></textarea></div></div>
    <div class="err" id="ferr"></div><button class="btn">Save listing</button></form>`);
}
async function modalLease(leadId, propId) {
  const [props, leads] = await Promise.all([api('/properties?all=1&listing_type=rent'), api('/leads')]);
  const free = props.filter((p) => p.status !== 'managed');
  const lead = leads.find((l) => String(l.id) === String(leadId));
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  overlay(`<h2>New lease</h2><p class="muted small">Creates the tenant account from the lead, the lease and a monthly rent schedule.</p>
    <form data-form="lease"><div class="row two"><div><label>Property (rentals)</label><select name="property_id" required>${opts(free, 'id', (p) => `${p.title} · ${price(p.price, 'rent')}`, propId)}</select></div>
    <div><label>Lead who becomes the tenant</label><select name="lead_id" required>${opts(leads.filter((l) => l.email), 'id', (l) => `${l.name} (${l.email})`, lead ? lead.id : '')}</select></div></div>
    <div class="row two"><div><label>Start</label><input name="start_date" type="date" value="${start}" required></div><div><label>End</label><input name="end_date" type="date" value="${end}" required></div></div>
    <div class="row three"><div><label>Monthly rent</label><input name="monthly_rent" type="number" required value="${(free.find((p) => String(p.id) === String(propId)) || free[0] || {}).price || ''}"></div><div><label>Deposit</label><input name="deposit" type="number"></div><div><label>Rent due day</label><input name="rent_due_day" type="number" min="1" max="28" value="1"></div></div>
    <div class="err" id="ferr"></div><button class="btn">Create lease</button></form>`);
}
async function modalTicket() {
  const props = isStaff() ? await api('/properties?all=1') : (await api('/management/leases')).map((l) => ({ id: l.property_id, title: l.property_title }));
  overlay(`<h2>Report a problem</h2><p class="muted small">The triage workflow sets the category and urgency and assigns a vendor.</p>
    <form data-form="ticket"><div class="row"><div><label>Property</label><select name="property_id" required>${opts(props, 'id', 'title')}</select></div></div>
    <div class="row"><div><label>What is wrong?</label><input name="title" required placeholder="Kitchen tap is leaking"></div></div>
    <div class="row"><div><label>Details</label><textarea name="description"></textarea></div></div>
    <div class="err" id="ferr"></div><button class="btn">Send report</button></form>`);
}
function modalSearch() {
  overlay(`<h2>Save a search</h2><p class="muted small">When a new undervalued listing matches, the alert workflow notifies you.</p>
    <form data-form="search"><div class="row"><div><label>Name</label><input name="name" required placeholder="Lahore bargains"></div></div>
    <div class="row three"><div><label>City</label><select name="city"><option value="">Any</option><option>Islamabad</option><option>Lahore</option><option>Karachi</option></select></div><div><label>For</label><select name="listing_type"><option value="">Any</option><option value="sale">Sale</option><option value="rent">Rent</option></select></div><div><label>Min. below fair price (%)</label><input name="min_gap_pct" type="number" value="15" min="1"></div></div>
    <div class="row three"><div><label>Max price (PKR)</label><input name="max_price" type="number"></div><div><label>Bedrooms</label><input name="beds" type="number" min="0"></div><div><label>Alert</label><select name="frequency"><option value="instant">Instantly</option><option value="weekly">Weekly digest</option></select></div></div>
    <div class="row"><div><label>Send by</label><select name="channel"><option value="email">Email</option><option value="telegram">Telegram</option></select></div></div>
    <div class="err" id="ferr"></div><button class="btn">Save search</button></form>`);
}

/* ======================= events ======================= */
const forms = {
  async login(d) { const r = await api('/auth/login', { method: 'POST', body: d }); setUser(r.token, r.user); location.hash = '#/dash/' + defaultTab(); },
  async inquiry(d) {
    d.budget = d.budget ? Number(d.budget) : undefined;
    await api('/leads', { method: 'POST', body: d });
    $('#pbox').innerHTML = `<div class="ok-box"><b>Thanks, ${esc(d.name)}.</b><br>Your inquiry is in. ${d.email ? 'A reply with next steps is on its way to ' + esc(d.email) + '.' : 'An agent will call you shortly.'}</div>`;
  },
  async booking(d) {
    if (!d.slot) throw new Error('Pick a time');
    if (!d.email && !d.phone) throw new Error('Add an email or phone number');
    await api('/viewings', { method: 'POST', body: { property_id: d.property_id, scheduled_at: `${d.date} ${d.slot}`, name: d.name, email: d.email, phone: d.phone } });
    $('#pbox').innerHTML = `<div class="ok-box"><b>Viewing booked for ${dt(d.date + ' ' + d.slot)}.</b><br>A confirmation and calendar invite are on their way.</div>`;
  },
  async leadsearch(d) { LF.q = d.q || ''; await views.leads($('#main')); },
  async note(d) { await api('/leads/' + d.id, { method: 'PATCH', body: { note: d.note } }); toast('Note added'); await openLead(d.id); },
  async listing(d) {
    d.images = (d.images || '').split('\n').map((x) => x.trim()).filter(Boolean);
    ['price', 'bedrooms', 'bathrooms', 'area_sqft', 'lat', 'lng', 'owner_id'].forEach((k) => { if (d[k]) d[k] = Number(d[k]); });
    await api('/properties', { method: 'POST', body: d });
    closeOverlay(); toast('Listing saved. The content workflow is writing its description.'); await views.listings($('#main'));
  },
  async lease(d) {
    const r = await api('/management/leases', { method: 'POST', body: d });
    closeOverlay();
    if (r.tenant_temp_password) overlay(`<h2>Lease created</h2><div class="ok-box">A tenant account was created. Share these details once:<br><b>${esc((await api('/leads/' + d.lead_id)).email)}</b> / <b>${esc(r.tenant_temp_password)}</b></div>`);
    else toast('Lease created');
    if (S.tab === 'management') await views.management($('#main'));
  },
  async ticket(d) { await api('/management/tickets', { method: 'POST', body: d }); closeOverlay(); toast('Reported. Triage is running.'); setTimeout(() => S.tab === 'management' && views.management($('#main')).catch(() => {}), 2500); await views.management($('#main')); },
  async search(d) {
    const filters = {};
    ['city', 'listing_type'].forEach((k) => d[k] && (filters[k] = d[k]));
    ['min_gap_pct', 'max_price', 'beds'].forEach((k) => d[k] && (filters[k] = Number(d[k])));
    await api('/deals/saved-searches', { method: 'POST', body: { name: d.name, filters, frequency: d.frequency, channel: d.channel } });
    closeOverlay(); toast('Search saved'); await views.deals($('#main'));
  },
};
const changes = {
  async ticketStatus(el) { await api('/management/tickets/' + el.dataset.id, { method: 'PATCH', body: { status: el.value } }); toast('Ticket updated'); },
};
const acts = {
  close: closeOverlay,
  logout: () => logout(),
  open: (el) => { location.hash = '#/property/' + el.dataset.id; },
  thumb: (el) => { $('#big').src = el.dataset.u; document.querySelectorAll('.thumbs img').forEach((i) => i.classList.toggle('on', i === el)); },
  ptab: (el) => { document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b === el)); showPanel(el.dataset.t); },
  slot: (el) => { $('#slot').value = el.dataset.t; document.querySelectorAll('.slots button').forEach((b) => b.classList.toggle('on', b === el)); },
  async demo(el) { const r = await api('/auth/login', { method: 'POST', body: { email: el.dataset.e, password: 'demo1234' } }); setUser(r.token, r.user); location.hash = '#/dash/' + defaultTab(); },
  lead: (el) => openLead(el.dataset.id),
  async lfilter(el) { LF[el.dataset.k] = el.dataset.v; await views.leads($('#main')); },
  async dfilter(el) { DF[el.dataset.k] = el.dataset.v; await views.deals($('#main')); },
  async leadStatus(el) { await api('/leads/' + el.dataset.id, { method: 'PATCH', body: { status: $('#lstatus').value } }); toast('Status saved'); await openLead(el.dataset.id); if (S.tab === 'leads') views.leads($('#main')); },
  async vset(el) { await api('/viewings/' + el.dataset.id, { method: 'PATCH', body: { status: el.dataset.s } }); toast(el.dataset.s === 'completed' ? 'Marked completed. The follow-up email is on its way.' : 'Viewing updated'); await views.viewings($('#main')); },
  newListing: modalListing,
  newLease: (el) => modalLease(el.dataset.lead, el.dataset.prop),
  newTicket: modalTicket,
  newSearch: modalSearch,
  async importSample() { const r = await api('/deals/import', { method: 'POST', body: { sample: true } }); toast(`Loaded ${r.imported} listings, ${r.undervalued} undervalued`); await views.deals($('#main')); },
  async promote(el) { const r = await api(`/deals/${el.dataset.id}/promote`, { method: 'POST' }); toast('Draft listing created'); await views.deals($('#main')); return r; },
  async delSearch(el) { await api('/deals/saved-searches/' + el.dataset.id, { method: 'DELETE' }); await views.deals($('#main')); },
  async paid(el) { await api(`/management/rent/${el.dataset.id}/pay`, { method: 'POST', body: {} }); toast('Marked paid'); await views.management($('#main')); },
  async simulate(el) {
    el.disabled = true;
    try { const r = await api('/automations/simulate-lead', { method: 'POST' }); toast('New lead arrived. Watch the run below.'); setTimeout(() => openLead(r.lead_id).catch(fail), 3200); }
    finally { el.disabled = false; }
  },
};
document.addEventListener('click', (e) => {
  const lt = e.target.closest('[data-lt]');
  if (lt) { F.listing_type = lt.dataset.lt; document.querySelectorAll('#seg button').forEach((b) => b.classList.toggle('on', b === lt)); loadListings().catch(fail); return; }
  const el = e.target.closest('[data-act]');
  if (el && acts[el.dataset.act]) Promise.resolve(acts[el.dataset.act](el, e)).catch(fail);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-act="open"]')) acts.open(e.target); });
document.addEventListener('submit', async (e) => {
  if (e.target.id === 'filters') { e.preventDefault(); return; }
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const btn = f.querySelector('button:not([type=button])');
  if (btn) btn.disabled = true;
  try { await forms[f.dataset.form](fd(f), f); }
  catch (err) { const box = $('#ferr'); if (box) box.textContent = err.message; else fail(err); }
  finally { if (btn) btn.disabled = false; }
});
document.addEventListener('input', (e) => {
  if (e.target.closest('#filters') && e.target.name === 'q') { clearTimeout(S.deb); S.deb = setTimeout(() => { F.q = e.target.value; loadListings().catch(fail); }, 300); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.closest('#filters') && t.name && t.name !== 'q') { F[t.name] = t.value; loadListings().catch(fail); }
  if (t.id === 'bdate') loadSlots(t.value);
  if (t.dataset && t.dataset.change && changes[t.dataset.change]) changes[t.dataset.change](t).catch(fail);
});

render();
