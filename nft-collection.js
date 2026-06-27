const { AssetsSDK, createApi } = require('@ton-community/assets-sdk');
const { TonClient4 } = require('@ton/ton');
const { WalletContractV4 } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');
const { internal, toNano } = require('@ton/ton');

async function getSDK() {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  const api = await createApi(isTestnet ? 'testnet' : 'mainnet');

  const mnemonic = (process.env.TON_MINTER_MNEMONIC || '').trim().split(/\s+/);
  const keyPair = await mnemonicToPrivateKey(mnemonic);

  // Use TonClient4 which assets-sdk uses internally
  const client = new TonClient4({
    endpoint: isTestnet
      ? 'https://sandbox-v4.tonhubapi.com'
      : 'https://mainnet-v4.tonhubapi.com'
  });

  const walletContract = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
  const wallet = client.open(walletContract);

  console.log('Minter wallet (v4r2):', wallet.address.toString({ bounceable: false }));

  const sender = {
    address: wallet.address,
    send: async (args) => {
      const seqno = await wallet.getSeqno().catch(() => 0);
      await wallet.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [args]
      });
    }
  };

  const storage = {
    pinataApiKey: process.env.PINATA_API_KEY || '',
    pinataSecretKey: process.env.PINATA_SECRET || ''
  };

  const sdk = AssetsSDK.create({ api, storage, sender });
  return { sdk };
}

async function deployCollection(name, description) {
  const { sdk } = await getSDK();
  console.log('Deploying NFT collection...');

  // Try to find correct param structure by looking at what sdk expects
  let collection;
  try {
    collection = await sdk.deployNftCollection({
      collectionContent: { name, description },
      commonContent: '',
      royaltyParams: { royaltyFactor: 0, royaltyBase: 100, royaltyAddress: sdk.sender.address }
    });
  } catch(e1) {
    console.log('Attempt 1 failed:', e1.message);
    try {
      collection = await sdk.deployNftCollection(
        { name, description },
        {}
      );
    } catch(e2) {
      console.log('Attempt 2 failed:', e2.message);
      collection = await sdk.deployNftCollection({ name, description });
    }
  }

  const address = collection.address.toString();
  console.log('COLLECTION ADDRESS:', address);
  return address;
}

module.exports = { deployCollection, getSDK };
