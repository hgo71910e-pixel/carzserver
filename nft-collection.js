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
  console.log('Deploying NFT collection...');

  const collection = await sdk.deployNftCollection({
    collectionContent: { name, description },
    commonContent: ''
  });

  const address = collection.address.toString();
  console.log('Collection deployed:', address);
  return address;
}

module.exports = { deployCollection, getSDK };
