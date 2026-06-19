const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      telegram_id TEXT PRIMARY KEY,
      username TEXT,
      coins INTEGER DEFAULT 0,
      total_spins INTEGER DEFAULT 0,
      total_coins_earned INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS plates (
      plate_key TEXT PRIMARY KEY,
      telegram_id TEXT,
      country TEXT,
      region TEXT,
      chars TEXT,
      upgrades TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS market (
      plate_key TEXT PRIMARY KEY,
      telegram_id TEXT,
      price INTEGER,
      seller_name TEXT,
      upgrades TEXT,
      added_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS duels (
      id TEXT PRIMARY KEY,
      player1_id TEXT,
      player1_username TEXT,
      player2_id TEXT,
      player2_username TEXT,
      flag TEXT,
      goal TEXT,
      combo_letters TEXT,
      stake INTEGER DEFAULT 0,
      status TEXT DEFAULT 'waiting',
      winner TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

module.exports = { pool, initDB };
