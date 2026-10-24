const { q, run, one, j } = require('../db');
const { trigger } = require('../automation/n8n');

const UNDERVALUED_GAP = 15; // % below the comparable median

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Fair price = median price per sqft of comparable listings (same city, type, listing kind) x area. */
async function recomputeEstimates() {
  const rows = await q('SELECT id, city, listing_type, property_type, price, area_sqft FROM market_listings WHERE area_sqft > 0');
  const groups = {};
  for (const r of rows) (groups[`${r.city}|${r.listing_type}|${r.property_type}`] ||= []).push(r);
  for (const list of Object.values(groups)) {
    if (list.length < 3) continue;
    const med = median(list.map((r) => r.price / r.area_sqft));
    for (const r of list) {
      const est = Math.round(med * r.area_sqft);
      const gap = Math.round(((est - r.price) / est) * 10000) / 100;
      await run('UPDATE market_listings SET estimated_price=?, price_gap_pct=?, is_undervalued=? WHERE id=?', [est, gap, gap >= UNDERVALUED_GAP ? 1 : 0, r.id]);
    }
  }
}

async function importRows(rows, source = 'import') {
  const ids = [];
  for (const r of rows) {
    if (!r.external_id || !r.price) continue;
    await run(
      `INSERT INTO market_listings (source, external_id, title, listing_type, property_type, price, bedrooms, area_sqft, city, area_name, lat, lng, url, raw)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), price=VALUES(price), bedrooms=VALUES(bedrooms), area_sqft=VALUES(area_sqft), url=VALUES(url)`,
      [source, String(r.external_id), r.title || null, r.listing_type || 'sale', r.property_type || 'house', r.price, r.bedrooms || null, r.area_sqft || null, r.city || null, r.area_name || null, r.lat || null, r.lng || null, r.url || null, JSON.stringify(r)]
    );
    const row = await one('SELECT id FROM market_listings WHERE source=? AND external_id=?', [source, String(r.external_id)]);
    ids.push(row.id);
  }
  await recomputeEstimates();
  return ids;
}

function matches(f, l) {
  const eq = (a, b) => !a || String(a).toLowerCase() === String(b || '').toLowerCase();
  if (!eq(f.city, l.city) || !eq(f.listing_type, l.listing_type) || !eq(f.property_type, l.property_type)) return false;
  if (f.min_price && l.price < f.min_price) return false;
  if (f.max_price && l.price > f.max_price) return false;
  if (f.beds && (l.bedrooms || 0) < f.beds) return false;
  return (l.price_gap_pct || 0) >= (f.min_gap_pct ?? UNDERVALUED_GAP);
}

/** For every new undervalued listing, create one alert per matching saved search and fire the n8n workflow. */
async function matchSavedSearches(listingIds) {
  if (!listingIds.length) return 0;
  const listings = await q('SELECT * FROM market_listings WHERE id IN (?) AND is_undervalued=1', [listingIds]);
  const searches = await q(
    `SELECT s.*, u.name AS user_name, u.email, u.telegram_chat_id FROM saved_searches s JOIN users u ON u.id=s.user_id WHERE s.is_active=1 AND s.frequency='instant'`
  );
  let n = 0;
  for (const s of searches) {
    const filters = j(s.filters) || {};
    for (const l of listings) {
      if (!matches(filters, l)) continue;
      const r = await run('INSERT IGNORE INTO alerts (saved_search_id, market_listing_id) VALUES (?,?)', [s.id, l.id]);
      if (!r.affectedRows) continue;
      n++;
      await trigger('deal_alert', 'deal-alert', {
        alert_id: r.insertId,
        search_name: s.name,
        channel: s.channel,
        user: { id: s.user_id, name: s.user_name, email: s.email, telegram_chat_id: s.telegram_chat_id },
        listing: l,
      }, { entityType: 'market_listing', entityId: l.id });
    }
  }
  return n;
}

// ---- deterministic sample market data (no scraping, no terms-of-service problems) --------------
function sampleRows() {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const cities = [
    { name: 'Islamabad', lat: 33.68, lng: 73.05, areas: ['F-11', 'G-13', 'DHA Phase 2', 'E-11'], sale: { house: 24000, apartment: 26000 }, rent: { house: 95, apartment: 85 } },
    { name: 'Lahore', lat: 31.52, lng: 74.35, areas: ['Gulberg III', 'DHA Phase 5', 'Bahria Town', 'Johar Town'], sale: { house: 19000, apartment: 21000 }, rent: { house: 80, apartment: 75 } },
    { name: 'Karachi', lat: 24.86, lng: 67.01, areas: ['Clifton', 'DHA Phase 6', 'Gulshan-e-Iqbal', 'North Nazimabad'], sale: { house: 17000, apartment: 18500 }, rent: { house: 70, apartment: 65 } },
  ];
  const out = [];
  let i = 0;
  for (const c of cities) for (const lt of ['sale', 'rent']) for (const pt of ['house', 'apartment']) {
    for (let k = 0; k < 4; k++, i++) {
      const area = Math.round((600 + rnd() * 2400) / 50) * 50;
      const base = c[lt][pt];
      const factor = k === 3 && rnd() > 0.35 ? 0.6 + rnd() * 0.18 : 0.9 + rnd() * 0.25; // some bargains
      const area_name = c.areas[Math.floor(rnd() * c.areas.length)];
      out.push({
        external_id: `SAMPLE-${i + 1}`, listing_type: lt, property_type: pt, city: c.name, area_name,
        title: `${Math.max(1, Math.round(area / 600))}-bed ${pt} in ${area_name}`,
        price: Math.round((base * area * factor) / 1000) * 1000,
        bedrooms: Math.max(1, Math.round(area / 600)), area_sqft: area,
        lat: +(c.lat + (rnd() - 0.5) * 0.08).toFixed(6), lng: +(c.lng + (rnd() - 0.5) * 0.08).toFixed(6),
      });
    }
  }
  return out;
}

module.exports = { importRows, matchSavedSearches, recomputeEstimates, sampleRows, UNDERVALUED_GAP };
