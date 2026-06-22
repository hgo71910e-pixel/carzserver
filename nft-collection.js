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

// Fetch compiled contract code from TON testnet
async function fetchContractCode(address) {
  const client = getClient(true);
  const state = await client.getContractState(Address.parse(address));
  return state.code;
}

// Known deployed NFT collection on testnet — we copy its code
const KNOWN_NFT_COLLECTION = 'EQD7bbIBUPQFYYBEdxvDHNoJiMTvKANyHiPl3VCr7K2K_aPY';
const KNOWN_NFT_ITEM = 'EQBCkgADUMkG_oMfOq_byJarFHK6FLCJm3HFa6cSFGrjkzGW';

async function deployCollection(collectionContentUrl) {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  const client = getClient(isTestnet);
  const { wallet, keyPair } = await getMinterWallet(client);
  const ownerAddress = wallet.address.toString();

  console.log('Owner:', ownerAddress);
  console.log('Fetching NFT contracts from testnet...');

  // Get NFT item code from known working contract
  let nftItemCode, collectionCode;
  try {
    const itemState = await client.getContractState(Address.parse(KNOWN_NFT_ITEM));
    nftItemCode = itemState.code;
    const colState = await client.getContractState(Address.parse(KNOWN_NFT_COLLECTION));
    collectionCode = colState.code;
    console.log('Contracts fetched OK');
  } catch(e) {
    throw new Error('Could not fetch contract code: ' + e.message);
  }

  const contentCell = beginCell()
    .storeUint(1, 8)
    .storeStringTail(collectionContentUrl)
    .endCell();

  const royaltyCell = beginCell()
    .storeUint(0, 16)
    .storeUint(100, 16)
    .storeAddress(Address.parse(ownerAddress))
    .endCell();

  const collectionData = beginCell()
    .storeAddress(Address.parse(ownerAddress))
    .storeUint(0, 64)
    .storeRef(contentCell)
    .storeRef(nftItemCode)
    .storeRef(royaltyCell)
    .endCell();

  const stateInit = { code: collectionCode, data: collectionData };
  const collectionAddr = contractAddress(0, stateInit);
  console.log('New collection address:', collectionAddr.toString());

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
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  const client = getClient(isTestnet);
  const state = await client.getContractState(Address.parse(KNOWN_NFT_ITEM));
  return state.code;
}

module.exports = { deployCollection, getNftItemCode };
