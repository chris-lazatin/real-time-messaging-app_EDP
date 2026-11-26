require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME || 'db_activity2',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.ping();
    console.log(
      `[DB] Connected to MySQL database "${process.env.DB_NAME || 'db_activity2'}" on ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}`
    );
  } catch (err) {
    console.error('[DB] Failed to connect to MySQL:', err.message);
    throw err;
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

module.exports = {
  pool,
  testConnection,
};
