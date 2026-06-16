require('dotenv').config();
const mysql = require('mysql2/promise');

const useMysql = process.env.USE_MYSQL === 'true';

let pool = null;

function getDbConfig() {
  const dbUrl = process.env.DB_URL || '';
  let config;

  if (dbUrl) {
    const parsed = new URL(dbUrl);
    const sslAccept = String(
      parsed.searchParams.get('sslaccept') ||
      parsed.searchParams.get('ssl-mode') ||
      ''
    ).toLowerCase();
    config = {
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      database: parsed.pathname.replace(/^\//, ''),
    };

    if (sslAccept && !['false', 'disable'].includes(sslAccept)) {
      config.ssl = {
        rejectUnauthorized: !['accept_invalid_certs', 'allow_invalid_certs', 'preferred'].includes(sslAccept),
      };
    }
  } else {
    config = {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'presenca_escolar',
    };
  }

  if (process.env.DB_SSL === 'true') {
    config.ssl = {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    };
  }

  return {
    ...config,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
    enableKeepAlive: true,
    dateStrings: true,
  };
}

async function getPool() {
  if (!useMysql) return null;
  if (!pool) {
    pool = mysql.createPool(getDbConfig());
  }
  return pool;
}

function isMysqlEnabled() {
  return useMysql;
}

module.exports = { getPool, isMysqlEnabled, getDbConfig };
