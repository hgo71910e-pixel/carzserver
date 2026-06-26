const { AssetsSDK, createApi, createSender } = require('@ton-community/assets-sdk');
const { TonClient, WalletContractV4 } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');

async function getSDK() {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  const api = await createApi(isTestnet ? 'testnet' : 'mainnet');

  // Используем тот же метод что работал раньше
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

  console.log('Minter wallet address:', wallet.address.toString());

  // Создаём sender из нашего кошелька
  const sender = {
    send: async (args) => {
      const seqno = await wallet.getSeqno().catch(() => 0);
      await wallet.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [args]
      });
    },
    address: wallet.address
  };

  const storage = {
    pinataApiKey: process.env.PINATA_API_KEY || '',
    pinataSecretKey: process.env.PINATA_SECRET || ''
  };

  const sdk = await AssetsSDK.create({ api, storage, sender });
  return { sdk, wallet, keyPair };
}

async function deployCollection(name, description) {
  const { sdk } = await getSDK();
  console.log('Deploying NFT collection...');

  const collection = await sdk.deployNftCollection({
    collectionContent: {
      type: 'offchain',
      uri: 'https://ipfs.io/ipfs/bafkreihaclz47kegqv5dbzx3uef6and3bkbx5g7ioefv4uqptxpam'
    },
    commonContent: {
      type: 'offchain',
      uri: ''
    }
  });

  const address = collection.address.toString();
  console.log('Collection deployed:', address);
  return address;
}

module.exports = { deployCollection, getSDK };
