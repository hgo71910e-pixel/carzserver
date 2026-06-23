const { AssetsSDK, createApi, createSender, importKey } = require('@ton-community/assets-sdk');
const { Address } = require('@ton/ton');

async function getSDK() {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  const api = await createApi(isTestnet ? 'testnet' : 'mainnet');
  const keyPair = await importKey(process.env.TON_MINTER_MNEMONIC || '');

  let sender;
  for (const t of ['v4r2', 'v4', 'highload-v2']) {
    try { sender = await createSender(t, keyPair, api); break; } catch(e) {}
  }
  if (!sender) throw new Error('No working wallet type');

  const storage = {
    pinataApiKey: process.env.PINATA_API_KEY || '',
    pinataSecretKey: process.env.PINATA_SECRET || ''
  };

  const sdk = await AssetsSDK.create({ api, storage, sender });
  return { sdk };
}

async function deployCollection(name, description) {
  const { sdk } = await getSDK();

  // Show what's actually available
  const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(sdk));
  const own = Object.keys(sdk);
  console.log('SDK proto methods:', proto.join(', '));
  console.log('SDK own keys:', own.join(', '));

  // Try all possible method names
  const possibleMethods = ['createNftCollection', 'createNFTCollection', 'deployNftCollection', 
    'createCollection', 'deployCollection', 'nftCollection', 'createNft'];
  for (const m of possibleMethods) {
    if (typeof sdk[m] === 'function') {
      console.log('Found method:', m);
    }
  }

  // Try calling whatever collection method exists
  let collection;
  if (typeof sdk.createNftCollection === 'function') {
    collection = await sdk.createNftCollection({ collectionContent: { name, description }, commonContent: '' });
  } else if (typeof sdk.createNFTCollection === 'function') {
    collection = await sdk.createNFTCollection({ collectionContent: { name, description }, commonContent: '' });
  } else {
    throw new Error('No collection method found. Available: ' + proto.concat(own).join(', '));
  }

  const address = collection.address.toString();
  console.log('Collection deployed:', address);
  return address;
}

module.exports = { deployCollection, getSDK };
