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
      ton_wallet_address TEXT,
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
      nft_activated BOOLEAN DEFAULT FALSE,
      nft_address TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS nfts (
      plate_key TEXT PRIMARY KEY,
      telegram_id TEXT,
      wallet_address TEXT,
      nft_address TEXT,
      metadata_url TEXT,
      image_url TEXT,
      network TEXT DEFAULT 'testnet',
      minted_at TIMESTAMP DEFAULT NOW()
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

  // Добавляем колонки если их нет (для существующих БД)
  await pool.query(`
    ALTER TABLE plates ADD COLUMN IF NOT EXISTS nft_activated BOOLEAN DEFAULT FALSE;
    ALTER TABLE plates ADD COLUMN IF NOT EXISTS nft_address TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS ton_wallet_address TEXT;
  `).catch(() => {});
}

module.exports = { pool, initDB };
