const { TonClient, WalletContractV4, internal, toNano, Address, beginCell, contractAddress, Cell } = require('@ton/ton');
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

  // Load verified NFT contracts from npm package
  let NftCollection;
  try {
    // Try @ton-community/nft-sdk first
    const sdk = require('@ton-community/nft-sdk');
    NftCollection = sdk.NftCollection || sdk.default?.NftCollection;
  } catch(e) {
    console.log('nft-sdk not available:', e.message);
  }

  if (NftCollection) {
    const collection = new NftCollection({
      ownerAddress: Address.parse(ownerAddress),
      royaltyPercent: 0,
      royaltyAddress: Address.parse(ownerAddress),
      nextItemIndex: 0,
      collectionContentUrl,
      commonContentUrl: ''
    });
    const stateInit = collection.stateInit;
    const collectionAddr = contractAddress(0, stateInit);
    console.log('Collection address:', collectionAddr.toString());
    const seqno = await wallet.getSeqno();
    await wallet.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      messages: [internal({ to: collectionAddr, value: toNano('0.1'), init: stateInit, body: beginCell().endCell(), bounce: false })]
    });
    await new Promise(r => setTimeout(r, 10000));
    return collectionAddr.toString();
  }

  throw new Error('@ton-community/nft-sdk not installed. Run: npm install @ton-community/nft-sdk');
}

module.exports = { deployCollection };
