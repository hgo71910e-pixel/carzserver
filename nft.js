const { getSDK } = require('./nft-collection');
const { Address } = require('@ton/ton');
const FormData = require('form-data');
const https = require('https');

async function uploadToPinata(buffer, filename, mimeType) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT not set');
  const form = new FormData();
  form.append('file', buffer, { filename, contentType: mimeType });
  form.append('pinataMetadata', JSON.stringify({ name: filename }));
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
  const data = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.pinata.cloud',
      path: '/pinning/pinFileToIPFS',
      method: 'POST',
      headers: { ...form.getHeaders(), 'Authorization': `Bearer ${jwt}` }
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

async function mintNFT({ plateKey, chars, country, region, ownerAddress, nftIndex }) {
  try {
    const collectionAddress = process.env.TON_COLLECTION_ADDRESS;
    if (!collectionAddress) throw new Error('TON_COLLECTION_ADDRESS not set');

    console.log('Minting NFT for plate', plateKey, 'index', nftIndex);

    // 1. Upload image
    const imgBuffer = generatePlateImage(chars, country, region);
    const imageUrl = await uploadToPinata(imgBuffer, plateKey + '.svg', 'image/svg+xml');
    console.log('Image uploaded:', imageUrl);

    // 2. Upload metadata
    const metadata = {
      name: 'Plate ' + (chars || '').toUpperCase() + (region ? ' ' + region : ''),
      description: 'CarzPlate NFT. Country: ' + (country || '') + '.',
      image: imageUrl,
      attributes: [
        { trait_type: 'Country', value: country || '' },
        { trait_type: 'Region', value: region || 'None' },
        { trait_type: 'Plate', value: (chars || '').toUpperCase() }
      ]
    };
    const metadataUrl = await uploadJsonToPinata(metadata, plateKey + '.json');
    console.log('Metadata uploaded:', metadataUrl);

    // 3. Mint via assets-sdk
    const { sdk } = await getSDK();
    const collection = sdk.openNftCollection(Address.parse(collectionAddress));

    console.log('Minting item via assets-sdk...');
    const nftItem = await collection.mintItem({
      itemOwnerAddress: Address.parse(ownerAddress),
      itemContent: {
        uri: metadataUrl
      }
    });

    await new Promise(r => setTimeout(r, 8000));

    const nftAddr = nftItem?.address?.toString() || collectionAddress + '_' + nftIndex;
    const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
    const explorerUrl = (isTestnet ? 'https://testnet.tonscan.org' : 'https://tonscan.org')
      + '/address/' + nftAddr;

    console.log('Mint complete! NFT:', nftAddr);
    return {
      ok: true,
      nft_address: nftAddr,
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
