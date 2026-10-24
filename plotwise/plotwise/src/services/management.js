const pad = (n) => String(n).padStart(2, '0');
const fmt = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** One rent_payments row per month between start and end, due on rentDueDay (capped at 28). */
function rentSchedule(start, end, dueDay) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const day = Math.min(Math.max(dueDay || 1, 1), 28);
  const out = [];
  let y = sy, m = sm - 1;
  for (;;) {
    const due = fmt(y, m, day);
    if (due > fmt(ey, em - 1, ed)) break;
    if (due >= start) out.push(due);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

module.exports = { rentSchedule };
