const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { pool, initDB } = require('./db');
const { mintNFT } = require('./nft');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Хранилище сокетов по telegram_id ──
const userSockets = {};

// ═══════════════════════════════════════
//  PLAYER
// ═══════════════════════════════════════

// Синхронизация игрока
app.post('/player/sync', async (req, res) => {
  try {
    const { telegram_id, username, coins, total_spins, total_coins_earned, ton_wallet_address } = req.body;
    if (!telegram_id) return res.json({ ok: false, error: 'no id' });

    const existing = await pool.query(
      'SELECT * FROM players WHERE telegram_id=$1', [String(telegram_id)]
    );

    if (existing.rows.length === 0) {
      // Новый игрок
      await pool.query(
        `INSERT INTO players (telegram_id, username, coins, total_spins, total_coins_earned, ton_wallet_address)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [String(telegram_id), username || 'player', coins || 0, total_spins || 0, total_coins_earned || 0, ton_wallet_address || null]
      );
      return res.json({ ok: true, coins: coins || 0, isNew: true });
    }

    const player = existing.rows[0];
    // Серверный баланс главный — не перезаписываем если сервер больше
    const serverCoins = Number(player.coins);
    const localCoins = Number(coins) || 0;
    const finalCoins = serverCoins >= localCoins ? serverCoins : localCoins;

    const newWallet = ton_wallet_address !== undefined ? ton_wallet_address : player.ton_wallet_address;
    await pool.query(
      `UPDATE players SET username=$2, coins=$3, total_spins=$4, total_coins_earned=$5, ton_wallet_address=$6, updated_at=NOW()
       WHERE telegram_id=$1`,
      [String(telegram_id), username || player.username, finalCoins,
       Math.max(total_spins || 0, player.total_spins || 0),
       Math.max(total_coins_earned || 0, player.total_coins_earned || 0),
       newWallet || null]
    );

    res.json({ ok: true, coins: finalCoins, ton_wallet_address: newWallet || null });
  } catch (e) {
    console.error(e);
    res.json({ ok: false, error: e.message });
  }
});

// Получить монеты игрока
app.get('/player/coins/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT coins, ton_wallet_address FROM players WHERE telegram_id=$1', [req.params.id]);
    if (!r.rows.length) return res.json({ ok: false });
    res.json({ ok: true, coins: Number(r.rows[0].coins), ton_wallet_address: r.rows[0].ton_wallet_address || null });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════
//  STATS
// ═══════════════════════════════════════

app.get('/stats/game', async (req, res) => {
  try {
    const [players, coins, plates, market, duels, days] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM players'),
      pool.query('SELECT SUM(coins) FROM players'),
      pool.query('SELECT COUNT(*) FROM plates'),
      pool.query('SELECT COUNT(*) FROM market'),
      pool.query("SELECT COUNT(*) FROM duels WHERE status='finished'"),
      pool.query(`SELECT DATE(created_at) as date, COUNT(*) as new_players
                  FROM players WHERE created_at >= NOW() - INTERVAL '30 days'
                  GROUP BY DATE(created_at) ORDER BY date ASC`)
    ]);
    res.json({
      ok: true,
      total_players: Number(players.rows[0].count),
      total_coins: Number(coins.rows[0].sum) || 0,
      total_plates: Number(plates.rows[0].count),
      plates_on_market: Number(market.rows[0].count),
      duels_finished: Number(duels.rows[0].count),
      days: days.rows
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/stats/players', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.telegram_id, p.username, p.coins, p.created_at,
             COUNT(pl.plate_key) as plates_count
      FROM players p
      LEFT JOIN plates pl ON pl.telegram_id = p.telegram_id
      GROUP BY p.telegram_id, p.username, p.coins, p.created_at
      ORDER BY p.coins DESC
    `);
    res.json({ ok: true, players: r.rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/stats/player/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const [player, plates, duels, logs] = await Promise.all([
      pool.query('SELECT * FROM players WHERE telegram_id=$1', [id]),
      pool.query('SELECT * FROM plates WHERE telegram_id=$1', [id]),
      pool.query(`SELECT * FROM duels WHERE player1_id=$1 OR player2_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]),
      pool.query(`SELECT * FROM player_logs WHERE telegram_id=$1 ORDER BY created_at DESC LIMIT 50`, [id]).catch(() => ({ rows: [] }))
    ]);
    if (!player.rows.length) return res.json({ ok: false, error: 'not found' });
    const p = player.rows[0];
    const dWon = duels.rows.filter(d => d.winner === id).length;
    const dLost = duels.rows.filter(d => d.status === 'finished' && d.winner && d.winner !== id).length;
    res.json({ ok: true, player: p, plates: plates.rows, duels: duels.rows, duels_won: dWon, duels_lost: dLost, logs: logs.rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════
//  PLATES
// ═══════════════════════════════════════

app.post('/plate/claim', async (req, res) => {
  try {
    const { telegram_id, country, region, chars, upgrades } = req.body;
    if (!telegram_id || !chars) return res.json({ ok: false, error: 'missing fields' });

    const plate_key = `${country}_${chars}_${region || ''}`.toLowerCase();

    const existing = await pool.query('SELECT * FROM plates WHERE plate_key=$1', [plate_key]);
    if (existing.rows.length > 0 && existing.rows[0].telegram_id !== String(telegram_id)) {
      return res.json({ ok: false, taken: true, plate_key });
    }

    await pool.query(
      `INSERT INTO plates (plate_key, telegram_id, country, region, chars, upgrades)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (plate_key) DO UPDATE SET upgrades=$6, telegram_id=$2`,
      [plate_key, String(telegram_id), country, region || '', chars, upgrades || '']
    );

    res.json({ ok: true, plate_key });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/plate/release', async (req, res) => {
  try {
    const { telegram_id, plate_key } = req.body;
    await pool.query(
      'DELETE FROM plates WHERE plate_key=$1 AND telegram_id=$2',
      [plate_key, String(telegram_id)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════
//  MARKET
// ═══════════════════════════════════════

app.post('/market/list', async (req, res) => {
  try {
    const { telegram_id, plate_key, price, seller_name, upgrades } = req.body;
    if (!plate_key || !price) return res.json({ ok: false, error: 'missing fields' });

    await pool.query(
      `INSERT INTO market (plate_key, telegram_id, price, seller_name, upgrades)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (plate_key) DO UPDATE SET price=$3, seller_name=$4, upgrades=$5`,
      [plate_key, String(telegram_id), price, seller_name || '', upgrades || '']
    );
    io.emit('market_updated');
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/market/unlist', async (req, res) => {
  try {
    const { telegram_id, plate_key } = req.body;
    await pool.query(
      'DELETE FROM market WHERE plate_key=$1 AND telegram_id=$2',
      [plate_key, String(telegram_id)]
    );
    io.emit('market_updated');
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/market/listings', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT m.*, pl.country, pl.region, pl.chars
      FROM market m
      LEFT JOIN plates pl ON pl.plate_key = m.plate_key
      ORDER BY m.added_at DESC
    `);
    res.json({ ok: true, listings: r.rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/market/buy', async (req, res) => {
  try {
    const { buyer_id, plate_key } = req.body;
    if (!buyer_id || !plate_key) return res.json({ ok: false, error: 'missing fields' });

    const lot = await pool.query('SELECT * FROM market WHERE plate_key=$1', [plate_key]);
    if (!lot.rows.length) return res.json({ ok: false, error: 'lot not found' });

    const { telegram_id: seller_id, price, seller_name } = lot.rows[0];
    const buyer = await pool.query('SELECT coins FROM players WHERE telegram_id=$1', [String(buyer_id)]);
    if (!buyer.rows.length) return res.json({ ok: false, error: 'buyer not found' });

    if (Number(buyer.rows[0].coins) < price) return res.json({ ok: false, error: 'not enough coins' });

    const sellerAmount = Math.floor(price * 0.9);

    // Снимаем монеты у покупателя
    await pool.query('UPDATE players SET coins=coins-$1 WHERE telegram_id=$2', [price, String(buyer_id)]);
    // Начисляем продавцу
    await pool.query('UPDATE players SET coins=coins+$1 WHERE telegram_id=$2', [sellerAmount, String(seller_id)]);
    // Переносим номер
    await pool.query('UPDATE plates SET telegram_id=$1 WHERE plate_key=$2', [String(buyer_id), plate_key]);
    // Убираем с маркета
    await pool.query('DELETE FROM market WHERE plate_key=$1', [plate_key]);

    const plateData = await pool.query('SELECT * FROM plates WHERE plate_key=$1', [plate_key]);

    io.emit('plate_sold', {
      plate_key,
      buyer_id: String(buyer_id),
      seller_id: String(seller_id),
      price,
      seller_amount: sellerAmount,
      plate_data: plateData.rows[0] || {}
    });

    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════
//  DUELS
// ═══════════════════════════════════════

app.post('/duel/create', async (req, res) => {
  try {
    const { flag, goal, combo_letters, stake, player1_id, player1_username } = req.body;
    const id = Math.random().toString(36).slice(2, 7).toUpperCase();

    if (stake > 0) {
      const p = await pool.query('SELECT coins FROM players WHERE telegram_id=$1', [String(player1_id)]);
      if (!p.rows.length || Number(p.rows[0].coins) < stake)
        return res.json({ ok: false, error: 'not enough coins' });
      await pool.query('UPDATE players SET coins=coins-$1 WHERE telegram_id=$2', [stake, String(player1_id)]);
    }

    await pool.query(
      `INSERT INTO duels (id, player1_id, player1_username, flag, goal, combo_letters, stake, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'waiting')`,
      [id, String(player1_id), player1_username || '', flag, goal, combo_letters || '', stake || 0]
    );

    res.json({ ok: true, room_id: id });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/duel/room/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM duels WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.json({ ok: false, error: 'not found' });
    res.json({ ok: true, room: r.rows[0] });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/duel/join/:id', async (req, res) => {
  try {
    const { player2_id, player2_username } = req.body;
    const room = await pool.query('SELECT * FROM duels WHERE id=$1', [req.params.id]);
    if (!room.rows.length) return res.json({ ok: false, error: 'not found' });

    const r = room.rows[0];
    if (r.status !== 'waiting') return res.json({ ok: false, error: 'room not available' });

    if (r.stake > 0) {
      const p = await pool.query('SELECT coins FROM players WHERE telegram_id=$1', [String(player2_id)]);
      if (!p.rows.length || Number(p.rows[0].coins) < r.stake)
        return res.json({ ok: false, error: 'not enough coins' });
      await pool.query('UPDATE players SET coins=coins-$1 WHERE telegram_id=$2', [r.stake, String(player2_id)]);
    }

    await pool.query(
      'UPDATE duels SET player2_id=$1, player2_username=$2, status=$3 WHERE id=$4',
      [String(player2_id), player2_username || '', 'ready', req.params.id]
    );

    io.to(req.params.id).emit('player_joined', { username: player2_username });
    res.json({ ok: true, player1_username: r.player1_username });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/duel/start/:id', async (req, res) => {
  try {
    await pool.query("UPDATE duels SET status='battle' WHERE id=$1", [req.params.id]);
    io.to(req.params.id).emit('battle_started');
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/duel/finish/:id', async (req, res) => {
  try {
    const { winner, surrendered } = req.body;
    const room = await pool.query('SELECT * FROM duels WHERE id=$1', [req.params.id]);
    if (!room.rows.length) return res.json({ ok: false });

    const r = room.rows[0];
    await pool.query(
      "UPDATE duels SET status='finished', winner=$1 WHERE id=$2",
      [winner || null, req.params.id]
    );

    // Начисляем выигрыш
    if (r.stake > 0 && winner && !winner.startsWith('opponent_of_')) {
      await pool.query('UPDATE players SET coins=coins+$1 WHERE telegram_id=$2', [r.stake * 2, String(winner)]);
    } else if (r.stake > 0 && (!winner || winner === 'draw')) {
      // Ничья — возвращаем ставки
      if (r.player1_id) await pool.query('UPDATE players SET coins=coins+$1 WHERE telegram_id=$2', [r.stake, String(r.player1_id)]);
      if (r.player2_id) await pool.query('UPDATE players SET coins=coins+$1 WHERE telegram_id=$2', [r.stake, String(r.player2_id)]);
    }

    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════
//  ADMIN
// ═══════════════════════════════════════

function isAdmin(admin_id) {
  return String(admin_id) === String(process.env.ADMIN_TG_ID || '');
}

app.post('/admin/give_coins', async (req, res) => {
  try {
    const { admin_id, target_id, amount } = req.body;
    if (!isAdmin(admin_id)) return res.json({ ok: false, error: 'not admin' });
    await pool.query('UPDATE players SET coins=coins+$1 WHERE telegram_id=$2', [amount, String(target_id)]);
    const sock = userSockets[String(target_id)];
    if (sock) io.to(sock).emit('admin_notify', { type: 'admin_coins_give', amount });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/admin/take_coins', async (req, res) => {
  try {
    const { admin_id, target_id, amount } = req.body;
    if (!isAdmin(admin_id)) return res.json({ ok: false, error: 'not admin' });
    await pool.query('UPDATE players SET coins=GREATEST(0,coins-$1) WHERE telegram_id=$2', [amount, String(target_id)]);
    const sock = userSockets[String(target_id)];
    if (sock) io.to(sock).emit('admin_notify', { type: 'admin_coins_take', amount });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/admin/give_upgrade', async (req, res) => {
  try {
    const { admin_id, target_id, upgrade_key } = req.body;
    if (!isAdmin(admin_id)) return res.json({ ok: false, error: 'not admin' });
    const sock = userSockets[String(target_id)];
    if (sock) io.to(sock).emit('admin_notify', { type: 'admin_upgrade_give', upgrade: upgrade_key });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/admin/remove_upgrade', async (req, res) => {
  try {
    const { admin_id, target_id, upgrade_key } = req.body;
    if (!isAdmin(admin_id)) return res.json({ ok: false, error: 'not admin' });
    const sock = userSockets[String(target_id)];
    if (sock) io.to(sock).emit('admin_notify', { type: 'admin_upgrade_take', upgrade: upgrade_key });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/admin/remove_plate', async (req, res) => {
  try {
    const { admin_id, target_id, plate_key } = req.body;
    if (!isAdmin(admin_id)) return res.json({ ok: false, error: 'not admin' });
    const plate = await pool.query('SELECT * FROM plates WHERE plate_key=$1', [plate_key]);
    await pool.query('DELETE FROM plates WHERE plate_key=$1', [plate_key]);
    await pool.query('DELETE FROM market WHERE plate_key=$1', [plate_key]);
    const sock = userSockets[String(target_id)];
    if (sock) io.to(sock).emit('admin_notify', { type: 'admin_plate_take', plate: plate.rows[0] || {} });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Трекинг открытий ──
app.post('/track', async (req, res) => {
  res.json({ ok: true });
});

// ── Задеплоить коллекцию (один раз, GET чтобы открыть в браузере) ──
app.get('/nft/deploy-collection', async (req, res) => {
  // Отвечаем сразу что начали, результат смотри в логах
  res.json({ ok: true, message: 'Deploy started, check Railway logs in 30 seconds for collection address' });
  
  try {
    const { deployCollection } = require('./nft-collection');
    console.log('Starting collection deploy...');
    const address = await deployCollection('CarzPlate', 'CarzPlate NFT Collection');
    console.log('COLLECTION ADDRESS:', address);
    console.log('Add to Railway: TON_COLLECTION_ADDRESS=' + address);
  } catch(e) {
    console.error('Deploy error:', e.message);
  }
});

// ── Адрес кошелька минтера ──
app.get('/nft/wallet', async (req, res) => {
  try {
    const { mnemonicToPrivateKey } = require('@ton/crypto');
    const { WalletContractV4, WalletContractV3R2, WalletContractV3R1, TonClient } = require('@ton/ton');
    const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
    const mnemonic = (process.env.TON_MINTER_MNEMONIC || '').trim().split(/\s+/);
    const keyPair = await mnemonicToPrivateKey(mnemonic);
    const client = new TonClient({
      endpoint: isTestnet
        ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
        : 'https://toncenter.com/api/v2/jsonRPC',
      apiKey: process.env.TON_API_KEY || ''
    });

    const wallets = {
      v4r2: WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 }),
      v3r2: WalletContractV3R2.create({ publicKey: keyPair.publicKey, workchain: 0 }),
      v3r1: WalletContractV3R1.create({ publicKey: keyPair.publicKey, workchain: 0 }),
    };

    const addresses = {};
    for (const [name, w] of Object.entries(wallets)) {
      addresses[name] = w.address.toString();
    }

    res.json({ ok: true, addresses, network: isTestnet ? 'testnet' : 'mainnet' });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});


// ═══════════════════════════════════════
//  NFT
// ═══════════════════════════════════════

// Активировать номер как NFT (тестовый минт)
app.post('/nft/mint', async (req, res) => {
  try {
    const { telegram_id, plate_key, wallet_address } = req.body;
    if (!telegram_id || !plate_key || !wallet_address) {
      return res.json({ ok: false, error: 'missing fields' });
    }

    // Проверяем что номер принадлежит игроку
    const plate = await pool.query(
      'SELECT * FROM plates WHERE plate_key=$1 AND telegram_id=$2',
      [plate_key, String(telegram_id)]
    );
    if (!plate.rows.length) return res.json({ ok: false, error: 'plate not found' });

    // Проверяем что не был уже заминчен
    const existing = await pool.query(
      'SELECT * FROM nfts WHERE plate_key=$1',
      [plate_key]
    );
    if (existing.rows.length) {
      return res.json({ ok: false, error: 'already minted', nft: existing.rows[0] });
    }

    const p = plate.rows[0];

    // Получаем следующий индекс NFT
    const idxRow = await pool.query('SELECT COUNT(*) FROM nfts');
    const nftIndex = parseInt(idxRow.rows[0].count) || 0;

    // Минтим NFT
    const result = await mintNFT({
      plateKey: plate_key,
      chars: p.chars,
      country: p.country,
      region: p.region,
      ownerAddress: wallet_address,
      nftIndex
    });

    if (!result.ok) return res.json({ ok: false, error: result.error });

    // Сохраняем в БД
    await pool.query(
      `INSERT INTO nfts (plate_key, telegram_id, wallet_address, nft_address, metadata_url, image_url, network)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (plate_key) DO UPDATE SET nft_address=$4, metadata_url=$5, image_url=$6`,
      [plate_key, String(telegram_id), wallet_address,
       result.nft_address, result.metadata_url, result.image_url,
       process.env.TON_NETWORK || 'testnet']
    );

    // Помечаем номер как активированный
    await pool.query(
      'UPDATE plates SET nft_activated=true, nft_address=$1 WHERE plate_key=$2',
      [result.nft_address, plate_key]
    );

    res.json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    res.json({ ok: false, error: e.message });
  }
});

// Получить NFT игрока
app.get('/nft/list/:telegram_id', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT n.*, p.chars, p.country, p.region
       FROM nfts n
       LEFT JOIN plates p ON p.plate_key = n.plate_key
       WHERE n.telegram_id=$1
       ORDER BY n.minted_at DESC`,
      [req.params.telegram_id]
    );
    res.json({ ok: true, nfts: r.rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════
//  SOCKET.IO
// ═══════════════════════════════════════

io.on('connection', (socket) => {
  socket.on('identify', ({ telegram_id }) => {
    if (telegram_id) userSockets[String(telegram_id)] = socket.id;
  });

  socket.on('join_room', (roomId) => {
    socket.join(roomId);
  });

  socket.on('player_won', ({ roomId }) => {
    socket.to(roomId).emit('opponent_won');
  });

  socket.on('surrender', ({ roomId }) => {
    socket.to(roomId).emit('opponent_won');
  });

  socket.on('opp_plate_spun', ({ roomId, plateObj }) => {
    socket.to(roomId).emit('opp_plate_spun', { plateObj });
  });

  socket.on('disconnect', () => {
    for (const [tid, sid] of Object.entries(userSockets)) {
      if (sid === socket.id) delete userSockets[tid];
    }
  });
});

// ═══════════════════════════════════════
//  START
// ═══════════════════════════════════════

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(e => {
  console.error('DB init failed:', e);
  process.exit(1);
});
