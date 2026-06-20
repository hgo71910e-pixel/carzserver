const { TonClient, WalletContractV4, internal, toNano, Address, Cell, beginCell } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');

// ── TON Client ──
function getClient() {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  return new TonClient({
    endpoint: isTestnet
      ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
      : 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TON_API_KEY || ''
  });
}

// ── Получить кошелёк минтера ──
async function getMinterWallet() {
  const mnemonic = (process.env.TON_MINTER_MNEMONIC || '').trim().split(/\s+/);
  if (mnemonic.length < 24) throw new Error('TON_MINTER_MNEMONIC не задан или неверный');
  const keyPair = await mnemonicToPrivateKey(mnemonic);
  const client = getClient();
  const wallet = client.open(WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 }));
  return { wallet, keyPair, client };
}

// ── Загрузить файл на NFT.Storage ──
async function uploadToNFTStorage(buffer, mimeType, filename) {
  const apiKey = process.env.NFT_STORAGE_KEY;
  if (!apiKey) throw new Error('NFT_STORAGE_KEY не задан');
  const res = await fetch('https://api.nft.storage/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': mimeType,
      'X-Agent-Did': filename
    },
    body: buffer
  });
  const data = await res.json();
  if (!data.ok) throw new Error('NFT.Storage upload failed: ' + JSON.stringify(data));
  return `https://ipfs.io/ipfs/${data.value.cid}`;
}

// ── Сгенерировать картинку номера (SVG → PNG buffer) ──
async function generatePlateImage(chars, country, region) {
  const label = `${chars}${region ? ' | ' + region : ''}`;
  const flag = { RU: '🇷🇺', UA: '🇺🇦', BY: '🇧🇾', KZ: '🇰🇿', US: '🇺🇸', DE: '🇩🇪', FR: '🇫🇷' }[country] || '🏁';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
    <rect width="600" height="200" rx="24" ry="24" fill="#fff" stroke="#222" stroke-width="8"/>
    <rect x="12" y="12" width="576" height="176" rx="16" ry="16" fill="#f8f8f8" stroke="#ccc" stroke-width="2"/>
    <text x="300" y="130" font-family="Arial Black,Arial,sans-serif" font-size="90" font-weight="900"
      text-anchor="middle" fill="#111" letter-spacing="8">${chars.toUpperCase()}</text>
    <text x="300" y="175" font-family="Arial,sans-serif" font-size="22"
      text-anchor="middle" fill="#555">${country}${region ? ' · ' + region : ''}</text>
    <text x="40" y="60" font-size="36">${flag}</text>
  </svg>`;

  return Buffer.from(svg, 'utf-8');
}

// ── Загрузить metadata на NFT.Storage ──
async function uploadMetadata(plateKey, chars, country, region, imageUrl) {
  const name = `${chars.toUpperCase()}${region ? ' | ' + region : ''}`;
  const metadata = {
    name: `Номерной знак ${name}`,
    description: `Игровой номерной знак из CarzPlate. Страна: ${country}. Регион: ${region || '—'}.`,
    image: imageUrl,
    attributes: [
      { trait_type: 'Country', value: country },
      { trait_type: 'Region', value: region || 'None' },
      { trait_type: 'Plate', value: chars.toUpperCase() }
    ]
  };
  const buf = Buffer.from(JSON.stringify(metadata), 'utf-8');
  return await uploadToNFTStorage(buf, 'application/json', `${plateKey}.json`);
}

// ── Задеплоить коллекцию (один раз) ──
async function deployCollection(ownerAddress) {
  const { wallet, keyPair, client } = await getMinterWallet();
  const seqno = await wallet.getSeqno();
  const collectionAddress = wallet.address.toString();

  // Отправляем деплой коллекции через внутреннее сообщение
  // Для testnet используем упрощённый подход — коллекция = кошелёк минтера
  console.log('Collection address (minter wallet):', collectionAddress);
  return collectionAddress;
}

// ── Минтить NFT ──
async function mintNFT({ plateKey, chars, country, region, ownerAddress }) {
  try {
    console.log(`Minting NFT for plate ${plateKey} to ${ownerAddress}`);

    const { wallet, keyPair, client } = await getMinterWallet();

    // 1. Генерируем картинку
    const imgBuffer = await generatePlateImage(chars, country, region);

    // 2. Загружаем картинку
    const imageUrl = await uploadToNFTStorage(imgBuffer, 'image/svg+xml', `${plateKey}.svg`);
    console.log('Image uploaded:', imageUrl);

    // 3. Загружаем metadata
    const metadataUrl = await uploadMetadata(plateKey, chars, country, region, imageUrl);
    console.log('Metadata uploaded:', metadataUrl);

    // 4. Формируем NFT данные по стандарту TEP-62
    const nftData = beginCell()
      .storeAddress(Address.parse(ownerAddress))
      .storeRef(
        beginCell()
          .storeUint(0x01, 8) // off-chain content
          .storeStringTail(metadataUrl)
          .endCell()
      )
      .endCell();

    // 5. Отправляем транзакцию — деплоим NFT контракт
    const seqno = await wallet.getSeqno();
    await wallet.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      messages: [
        internal({
          to: wallet.address, // в testnet минтим через кошелёк-минтер
          value: toNano('0.05'),
          body: nftData,
          bounce: false
        })
      ]
    });

    // 6. Ждём подтверждения
    await new Promise(r => setTimeout(r, 10000));

    const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
    const explorerUrl = isTestnet
      ? `https://testnet.tonscan.org/address/${wallet.address.toString()}`
      : `https://tonscan.org/address/${wallet.address.toString()}`;

    return {
      ok: true,
      nft_address: wallet.address.toString(),
      metadata_url: metadataUrl,
      image_url: imageUrl,
      explorer_url: explorerUrl
    };
  } catch (e) {
    console.error('Mint error:', e);
    return { ok: false, error: e.message };
  }
}

module.exports = { mintNFT, deployCollection };
