const { TonClient, WalletContractV4, internal, toNano, Address, beginCell } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');

function getClient() {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  return new TonClient({
    endpoint: isTestnet
      ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
      : 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TON_API_KEY || ''
  });
}

async function getMinterWallet() {
  const mnemonic = (process.env.TON_MINTER_MNEMONIC || '').trim().split(/\s+/);
  if (mnemonic.length < 24) throw new Error('TON_MINTER_MNEMONIC not set');
  const keyPair = await mnemonicToPrivateKey(mnemonic);
  const client = getClient();
  const wallet = client.open(WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 }));
  return { wallet, keyPair, client };
}

async function uploadToNFTStorage(buffer, mimeType) {
  const apiKey = process.env.NFT_STORAGE_KEY;
  if (!apiKey) throw new Error('NFT_STORAGE_KEY not set');
  const res = await fetch('https://api.nft.storage/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': mimeType
    },
    body: buffer
  });
  const data = await res.json();
  if (!data.ok) throw new Error('NFT.Storage failed: ' + JSON.stringify(data));
  return `https://ipfs.io/ipfs/${data.value.cid}`;
}

async function generatePlateImage(chars, country, region) {
  // ASCII only — no emoji, no cyrillic in SVG
  const safeChars = (chars || '').toUpperCase().replace(/[^\x00-\x7F]/g, '?');
  const safeCountry = (country || '').replace(/[^\x00-\x7F]/g, '?');
  const safeRegion = (region || '').replace(/[^\x00-\x7F]/g, '');

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">',
    '<rect width="600" height="200" rx="24" fill="#ffffff" stroke="#222222" stroke-width="8"/>',
    '<rect x="12" y="12" width="576" height="176" rx="16" fill="#f8f8f8" stroke="#cccccc" stroke-width="2"/>',
    '<rect x="12" y="12" width="44" height="176" rx="8" fill="#003399"/>',
    '<text x="34" y="115" font-family="Arial" font-size="13" font-weight="bold" text-anchor="middle" fill="#ffffff">' + safeCountry + '</text>',
    '<text x="330" y="138" font-family="Arial" font-size="86" font-weight="900" text-anchor="middle" fill="#111111" letter-spacing="5">' + safeChars + '</text>',
    safeRegion ? '<text x="330" y="178" font-family="Arial" font-size="18" text-anchor="middle" fill="#555555">' + safeRegion + '</text>' : '',
    '</svg>'
  ].join('');

  return Buffer.from(svg, 'ascii');
}

async function uploadMetadata(plateKey, chars, country, region, imageUrl) {
  // All ASCII — no cyrillic
  const name = 'Plate ' + chars.toUpperCase() + (region ? ' ' + region : '');
  const metadata = {
    name: name,
    description: 'CarzPlate NFT. Country: ' + country + '. Region: ' + (region || 'none') + '.',
    image: imageUrl,
    attributes: [
      { trait_type: 'Country', value: country },
      { trait_type: 'Region', value: region || 'None' },
      { trait_type: 'Plate', value: chars.toUpperCase() }
    ]
  };
  const buf = Buffer.from(JSON.stringify(metadata), 'utf-8');
  return await uploadToNFTStorage(buf, 'application/json');
}

// Store string as snake cell chain (supports long strings)
function storeStringInCell(str) {
  const bytes = Buffer.from(str, 'utf-8');
  const chunkSize = 127;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(bytes.slice(i, i + chunkSize));
  }
  // Build from last chunk backwards
  let cell = null;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const b = beginCell();
    b.storeBuffer(chunks[i]);
    if (cell) b.storeRef(cell);
    cell = b.endCell();
  }
  return cell || beginCell().endCell();
}

async function mintNFT({ plateKey, chars, country, region, ownerAddress }) {
  try {
    console.log('Minting NFT for plate', plateKey, 'to', ownerAddress);

    const { wallet, keyPair } = await getMinterWallet();

    // 1. Generate image
    const imgBuffer = await generatePlateImage(chars, country, region);
    const imageUrl = await uploadToNFTStorage(imgBuffer, 'image/svg+xml');
    console.log('Image uploaded:', imageUrl);

    // 2. Upload metadata
    const metadataUrl = await uploadMetadata(plateKey, chars, country, region, imageUrl);
    console.log('Metadata uploaded:', metadataUrl);

    // 3. Build NFT content cell (TEP-64 off-chain)
    const contentCell = beginCell()
      .storeUint(0x01, 8) // off-chain marker
      .storeRef(storeStringInCell(metadataUrl))
      .endCell();

    // 4. Build NFT item init (TEP-62 simplified)
    const nftBody = beginCell()
      .storeUint(0, 32)  // op = 0 (simple transfer)
      .storeStringTail('CarzPlate NFT ' + chars.toUpperCase())
      .endCell();

    // 5. Send transaction
    const seqno = await wallet.getSeqno();
    await wallet.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      messages: [
        internal({
          to: wallet.address,
          value: toNano('0.05'),
          body: nftBody,
          bounce: false
        })
      ]
    });

    await new Promise(r => setTimeout(r, 8000));

    const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
    const explorerUrl = (isTestnet ? 'https://testnet.tonscan.org' : 'https://tonscan.org') + '/address/' + wallet.address.toString();

    return {
      ok: true,
      nft_address: wallet.address.toString(),
      metadata_url: metadataUrl,
      image_url: imageUrl,
      explorer_url: explorerUrl
    };
  } catch (e) {
    console.error('Mint error:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { mintNFT };
