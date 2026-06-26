const { AssetsSDK, createApi, createWalletV4 } = require('@ton-community/assets-sdk');

async function getSDK() {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  const api = await createApi(isTestnet ? 'testnet' : 'mainnet');

  const storage = {
    pinataApiKey: process.env.PINATA_API_KEY || '',
    pinataSecretKey: process.env.PINATA_SECRET || ''
  };

  const wallet = await createWalletV4(process.env.TON_MINTER_MNEMONIC || '', api);

  const sdk = await AssetsSDK.create({ api, storage, sender: wallet });
  return { sdk };
}

async function deployCollection(name, description) {
  const { sdk } = await getSDK();
  console.log('Deploying NFT collection...');

  const collection = await sdk.createNftCollection(
    { name, description },
    { amount: BigInt('100000000') } // 0.1 TON
  );

  const address = collection.address.toString();
  console.log('Collection deployed:', address);
  return address;
}

module.exports = { deployCollection, getSDK };
