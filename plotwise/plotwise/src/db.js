require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');

function connectionConfig(extra = {}) {
  const url = new URL(process.env.DATABASE_URL || 'mysql://root:root@127.0.0.1:3306/plotwise');
  const sslMode = (url.searchParams.get('ssl-mode') || '').toUpperCase();
  let ca = null;
  if (process.env.DB_CA_PEM) ca = process.env.DB_CA_PEM.replace(/\\n/g, '\n');
  else if (process.env.DB_CA_PATH) ca = fs.readFileSync(process.env.DB_CA_PATH, 'utf8');
  let ssl;
  if (ca) ssl = { ca, rejectUnauthorized: true };
  else if (sslMode === 'REQUIRED' || sslMode === 'VERIFY_CA') ssl = { rejectUnauthorized: false };
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) || 'defaultdb',
    ssl,
    dateStrings: true,
    decimalNumbers: true,
    charset: 'utf8mb4',
    ...extra,
  };
}

const TZ = process.env.APP_TZ_OFFSET || '+05:00';
const pool = mysql.createPool(connectionConfig({ waitForConnections: true, connectionLimit: 8 }));
pool.pool.on('connection', (c) => c.query(`SET time_zone='${TZ}'`));

const q = async (sql, params = []) => (await pool.query(sql, params))[0];
const one = async (sql, params = []) => (await q(sql, params))[0] || null;
const run = q; // INSERT/UPDATE return a ResultSetHeader (insertId, affectedRows)
const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const exec = async (sql, params = []) => (await conn.query(sql, params))[0];
    const out = await fn(exec);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { pool, q, one, run, j, tx, connectionConfig };
