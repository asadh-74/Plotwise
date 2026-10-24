const r = require('express').Router();
const bcrypt = require('bcryptjs');
const { one, run } = require('../db');
const { sign, auth } = require('../auth');

r.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = email && (await one('SELECT * FROM users WHERE email=? AND is_active=1', [String(email).toLowerCase().trim()]));
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) return res.status(401).json({ error: 'Email or password is wrong' });
  res.json({ token: sign(u), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

r.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'Name, email and a password of 8+ characters are required' });
  const mail = String(email).toLowerCase().trim();
  if (await one('SELECT id FROM users WHERE email=?', [mail])) return res.status(409).json({ error: 'That email already has an account' });
  const x = await run('INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)', [name, mail, phone || null, await bcrypt.hash(password, 10), 'buyer']);
  const u = await one('SELECT * FROM users WHERE id=?', [x.insertId]);
  res.status(201).json({ token: sign(u), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

r.get('/me', auth(), async (req, res) => {
  res.json(await one('SELECT id,name,email,phone,role,telegram_chat_id FROM users WHERE id=?', [req.user.id]));
});

r.patch('/me', auth(), async (req, res) => {
  const { phone, telegram_chat_id } = req.body || {};
  await run('UPDATE users SET phone=COALESCE(?,phone), telegram_chat_id=COALESCE(?,telegram_chat_id) WHERE id=?', [phone ?? null, telegram_chat_id ?? null, req.user.id]);
  res.json({ ok: true });
});

module.exports = r;
