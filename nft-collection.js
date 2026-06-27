const { AssetsSDK, createApi, createSender, importKey } = require('@ton-community/assets-sdk');

async function getSDK() {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  const api = await createApi(isTestnet ? 'testnet' : 'mainnet');
  const keyPair = await importKey(process.env.TON_MINTER_MNEMONIC || '');
  const sender = await createSender('highload-v2', keyPair, api);

  const storage = {
    pinataApiKey: process.env.PINATA_API_KEY || '',
    pinataSecretKey: process.env.PINATA_SECRET || ''
  };

  const sdk = AssetsSDK.create({ api, storage, sender });
  console.log('Minter wallet address:', sdk.sender?.address?.toString());
  return { sdk };
}

async function deployCollection(name, description) {
  const { sdk } = await getSDK();
  console.log('Deploying NFT collection...');

  const collection = await sdk.deployNftCollection({
    name,
    description,
    image: 'https://ipfs.io/ipfs/bafkreihaclz47kegqv5dbzx3uef6and3bkbx5g7ioefv4uqptxpam'
  });

  const address = collection.address.toString();
  console.log('COLLECTION ADDRESS:', address);
  return address;
}

module.exports = { deployCollection, getSDK };
