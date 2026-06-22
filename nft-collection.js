const { AssetsSDK, PinataStorageParams } = require('@ton-community/assets-sdk');
const { TonClient, WalletContractV4 } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');

async function getSDK() {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  const mnemonic = (process.env.TON_MINTER_MNEMONIC || '').trim().split(/\s+/);
  const keyPair = await mnemonicToPrivateKey(mnemonic);

  const client = new TonClient({
    endpoint: isTestnet
      ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
      : 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TON_API_KEY || ''
  });

  const wallet = client.open(
    WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 })
  );

  const sdk = AssetsSDK.create({
    api: isTestnet ? 'testnet' : 'mainnet',
    wallet,
    storage: new PinataStorageParams({
      pinataApiKey: process.env.PINATA_API_KEY || '',
      pinataSecretApiKey: process.env.PINATA_SECRET || '',
      pinataJWT: process.env.PINATA_JWT || ''
    })
  });

  return { sdk, keyPair };
}

async function deployCollection(name, description) {
  const { sdk } = await getSDK();
  console.log('Deploying collection via assets-sdk...');

  const collection = await sdk.createNftCollection({
    collectionContent: {
      name: name || 'CarzPlate',
      description: description || 'CarzPlate NFT Collection - Номерные знаки'
    },
    commonContent: ''
  });

  const address = collection.address.toString();
  console.log('Collection deployed:', address);
  return address;
}

module.exports = { deployCollection, getSDK };
