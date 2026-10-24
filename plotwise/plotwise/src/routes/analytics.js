const r = require('express').Router();
const { q, one } = require('../db');
const { auth, roles, STAFF } = require('../auth');

r.get('/summary', auth(), roles(...STAFF), async (_req, res) => {
  const [funnel, bySource, byLabel, perDay, topListings, resp, rent, lease, runs, byWorkflow, counts] = await Promise.all([
    q('SELECT status, COUNT(*) n FROM leads GROUP BY status'),
    q('SELECT source, COUNT(*) n FROM leads GROUP BY source ORDER BY n DESC'),
    q("SELECT COALESCE(score_label,'unscored') label, COUNT(*) n FROM leads GROUP BY label"),
    q('SELECT DATE(created_at) d, COUNT(*) n FROM leads WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) GROUP BY d ORDER BY d'),
    q(`SELECT p.id, p.title, COUNT(l.id) leads, SUM(l.status='viewing_booked' OR l.status='negotiation' OR l.status='won') progressed,
         (SELECT COUNT(*) FROM viewings v WHERE v.property_id=p.id) viewings
       FROM properties p LEFT JOIN leads l ON l.property_id=p.id GROUP BY p.id, p.title HAVING leads>0 ORDER BY leads DESC LIMIT 6`),
    one(`SELECT AVG(sec) avg_sec, MIN(sec) min_sec, COUNT(*) n FROM (
           SELECT TIMESTAMPDIFF(SECOND, l.created_at, MIN(a.created_at)) sec FROM leads l
           JOIN lead_activities a ON a.lead_id=l.id AND a.type='ai_reply_sent' GROUP BY l.id) t`),
    one(`SELECT COALESCE(SUM(CASE WHEN status='paid' AND DATE_FORMAT(paid_at,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m') THEN amount END),0) collected_month,
                COALESCE(SUM(CASE WHEN status='overdue' THEN amount END),0) overdue_amount, SUM(status='overdue') overdue_count FROM rent_payments`),
    one(`SELECT SUM(status IN ('active','expiring')) active, SUM(DATEDIFF(end_date,CURDATE()) BETWEEN 0 AND 90 AND status IN ('active','expiring')) expiring_90 FROM leases`),
    one(`SELECT COUNT(*) total, SUM(status='success') ok, SUM(status='failed') failed FROM automation_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`),
    q(`SELECT workflow, COUNT(*) n, SUM(status='success') ok, SUM(status='failed') failed, ROUND(AVG(duration_ms)) avg_ms FROM automation_runs GROUP BY workflow ORDER BY n DESC`),
    one(`SELECT (SELECT COUNT(*) FROM properties WHERE status='active') listings, (SELECT COUNT(*) FROM leads) leads,
                (SELECT COUNT(*) FROM leads WHERE score_label='hot' AND status NOT IN ('won','lost')) hot_open,
                (SELECT COUNT(*) FROM market_listings WHERE is_undervalued=1) deals,
                (SELECT COUNT(*) FROM maintenance_tickets WHERE status IN ('open','assigned','in_progress')) open_tickets`),
  ]);
  res.json({ funnel, bySource, byLabel, perDay, topListings, response: resp, rent, lease, runs, byWorkflow, counts });
});

module.exports = r;
