const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const STAFF = ['admin', 'agent'];

const sign = (u) => jwt.sign({ id: u.id, role: u.role, name: u.name, email: u.email }, SECRET, { expiresIn: '7d' });

const auth = (required = true) => (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return required ? res.status(401).json({ error: 'Log in to continue' }) : next();
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    if (required) return res.status(401).json({ error: 'Session expired. Log in again' });
    next();
  }
};

const roles = (...allowed) => (req, res, next) =>
  allowed.includes(req.user && req.user.role) ? next() : res.status(403).json({ error: 'Your role cannot do this' });

// Shared-secret guard for endpoints that n8n calls
const automationSecret = (req, res, next) => {
  const expected = process.env.AUTOMATION_SECRET || 'dev-secret';
  if (req.headers['x-automation-secret'] !== expected) return res.status(401).json({ error: 'Bad automation secret' });
  next();
};

module.exports = { sign, auth, roles, automationSecret, STAFF };
