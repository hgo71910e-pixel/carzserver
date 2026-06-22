const { TonClient, WalletContractV4, internal, toNano, Address, beginCell, contractAddress } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');

function getClient(isTestnet) {
  return new TonClient({
    endpoint: isTestnet
      ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
      : 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TON_API_KEY || ''
  });
}

async function getMinterWallet(client) {
  const mnemonic = (process.env.TON_MINTER_MNEMONIC || '').trim().split(/\s+/);
  const keyPair = await mnemonicToPrivateKey(mnemonic);
  const wallet = client.open(WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 }));
  return { wallet, keyPair };
}

async function deployCollection(collectionContentUrl) {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  const client = getClient(isTestnet);
  const { wallet, keyPair } = await getMinterWallet(client);
  const ownerAddress = wallet.address.toString();

  console.log('Owner:', ownerAddress);

  // Use @ton-community/nft-sdk for verified contract code
  let NftCollection;
  try {
    NftCollection = require('@ton-community/nft-sdk').NftCollection;
  } catch(e) {
    throw new Error('Please install @ton-community/nft-sdk: ' + e.message);
  }

  const collection = NftCollection.create({
    ownerAddress: Address.parse(ownerAddress),
    royaltyPercent: 0,
    royaltyAddress: Address.parse(ownerAddress),
    nextItemIndex: 0,
    collectionContentUrl,
    commonContentUrl: ''
  });

  const collectionAddr = contractAddress(0, await collection.getStateInit());
  console.log('Collection address:', collectionAddr.toString());

  const stateInit = await collection.getStateInit();
  const seqno = await wallet.getSeqno();

  await wallet.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to: collectionAddr,
        value: toNano('0.1'),
        init: stateInit,
        body: beginCell().endCell(),
        bounce: false
      })
    ]
  });

  console.log('Deploy sent, waiting 10s...');
  await new Promise(r => setTimeout(r, 10000));
  console.log('Done!');
  return collectionAddr.toString();
}

async function getNftItemCode() {
  const { NftItem } = require('@ton-community/nft-sdk');
  return NftItem.getCode();
}

module.exports = { deployCollection, getNftItemCode };
