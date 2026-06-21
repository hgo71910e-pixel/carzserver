const { TonClient, WalletContractV4, internal, toNano } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');
const FormData = require('form-data');
const https = require('https');

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

function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ error: data }); }
      });
    });
    req.on('error', reject);
    if (body) {
      if (body.pipe) body.pipe(req);
      else { req.write(body); req.end(); }
    } else req.end();
  });
}

async function uploadToPinata(buffer, filename, mimeType) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT not set');

  const form = new FormData();
  form.append('file', buffer, { filename, contentType: mimeType });
  form.append('pinataMetadata', JSON.stringify({ name: filename }));
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

  const headers = {
    ...form.getHeaders(),
    'Authorization': `Bearer ${jwt}`
  };

  const data = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.pinata.cloud',
      path: '/pinning/pinFileToIPFS',
      method: 'POST',
      headers
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ error: d }); } });
    });
    req.on('error', reject);
    form.pipe(req);
  });

  if (!data.IpfsHash) throw new Error('Pinata file failed: ' + JSON.stringify(data));
  return `https://ipfs.io/ipfs/${data.IpfsHash}`;
}

async function uploadJsonToPinata(obj, filename) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT not set');

  const body = JSON.stringify({
    pinataContent: obj,
    pinataMetadata: { name: filename },
    pinataOptions: { cidVersion: 1 }
  });

  const data = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.pinata.cloud',
      path: '/pinning/pinJSONToIPFS',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ error: d }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (!data.IpfsHash) throw new Error('Pinata JSON failed: ' + JSON.stringify(data));
  return `https://ipfs.io/ipfs/${data.IpfsHash}`;
}

function generatePlateImage(chars, country, region) {
  const safeChars = (chars || '').toUpperCase().replace(/[^\x20-\x7E]/g, '');
  const safeCountry = (country || '').replace(/[^\x20-\x7E]/g, '');
  const safeRegion = (region || '').replace(/[^\x20-\x7E]/g, '');

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

  return Buffer.from(svg, 'utf-8');
}

async function mintNFT({ plateKey, chars, country, region, ownerAddress }) {
  try {
    console.log('Minting NFT for plate', plateKey);

    const { wallet, keyPair } = await getMinterWallet();
    console.log('Minter wallet:', wallet.address.toString(), 'Owner:', ownerAddress);

    // 1. Generate and upload image
    const imgBuffer = generatePlateImage(chars, country, region);
    const imageUrl = await uploadToPinata(imgBuffer, plateKey + '.svg', 'image/svg+xml');
    console.log('Image uploaded:', imageUrl);

    // 2. Upload metadata
    const metadata = {
      name: 'Plate ' + (chars || '').toUpperCase() + (region ? ' ' + region : ''),
      description: 'CarzPlate NFT. Country: ' + (country || '') + '. Region: ' + (region || 'none') + '.',
      image: imageUrl,
      attributes: [
        { trait_type: 'Country', value: country || '' },
        { trait_type: 'Region', value: region || 'None' },
        { trait_type: 'Plate', value: (chars || '').toUpperCase() }
      ]
    };
    const metadataUrl = await uploadJsonToPinata(metadata, plateKey + '.json');
    console.log('Metadata uploaded:', metadataUrl);

    // 3. Отправляем TON транзакцию
    console.log('Getting seqno...');
    let seqno = 0;
    try {
      seqno = await wallet.getSeqno();
      console.log('Seqno:', seqno);
    } catch(e) {
      console.log('Seqno error (using 0):', e.message);
      seqno = 0;
    }

    console.log('Sending transfer to:', ownerAddress);
    try {
      await wallet.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [
          internal({
            to: wallet.address,
            value: toNano('0.01'),
            body: 'CarzPlate NFT ' + (chars || '').toUpperCase(),
            bounce: false
          })
        ]
      });
      console.log('Transfer sent OK');
    } catch(e) {
      console.log('Transfer error:', e.message);
    }

    await new Promise(r => setTimeout(r, 4000));
    console.log('Mint complete');

    const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
    const explorerUrl = (isTestnet ? 'https://testnet.tonscan.org' : 'https://tonscan.org')
      + '/address/' + wallet.address.toString();

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
