const { AssetsSDK, createApi, createSender, importKey } = require('@ton-community/assets-sdk');

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

  // Correct params per source code: name, description, image are top-level
  const collection = await sdk.createNftCollection(
    { name, description },
    { amount: BigInt('100000000') }
  );

  const address = collection.address.toString();
  console.log('COLLECTION ADDRESS:', address);
  return address;
}

module.exports = { deployCollection, getSDK };
