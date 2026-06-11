require('dotenv').config();
const mysql = require('mysql2/promise');

const useMysql = process.env.USE_MYSQL === 'true';

let pool = null;

async function getPool() {
  if (!useMysql) return null;
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'presenca_escolar',
      waitForConnections: true,
      connectionLimit: 10,
    });
  }
  return pool;
}

function isMysqlEnabled() {
  return useMysql;
}

module.exports = { getPool, isMysqlEnabled };
