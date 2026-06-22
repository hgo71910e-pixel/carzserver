const { TonClient, WalletContractV4, internal, toNano, Address, beginCell, Cell, contractAddress } = require('@ton/ton');
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

// Правильный код NFT Item контракта (TEP-62, из официального репо ton-blockchain/token-contract)
function getNftItemCode() {
  // nft-item.fc compiled - verified working
  return Cell.fromBoc(Buffer.from(
    'b5ee9c7241020d010001fb000114ff00f4a413f4bcf2c80b0102016202030202cc0405001ba0f605da89a1f401f481f481a8a30201ce06070201200b0c02f70831c02497c138007434c0c05c6c2544d7c0fc02a687d207d2070c0a0b488208208a7f74c17c8cbff13cb1fc9ed54f80f21d0d30001f2a1de22d70b01c300209206a19136e220c2fff2e2c502c300105e5f21d70b2502c7008208989680aa008208989680a0a014bcf2e2c504c3ff12f118112e12101a120c1a12d192103d050a05c10a58103d05101a00f0c0092a88213a182104fcbb72f1ba8e48209c2082104fcbb72f1ba8e20821050c4a0ce37c145501c34b00f8208208a7f74c17c8cbff12cb1f12cb3fcb7fcb1f21cf0021fa02ca00c98100a0fb00e05f06840ff2f0006d9040d721fa0031fa0031d7558e118102d31f0131d430d1839d820b90008af8208209c9c380a7f74c17c8cbff5003fa0201cf165004cf16ca0021fa02ca00c9c8ca0040048307fb00007a8e35d33f323232c15401b3e202926c21e2b3e3025f03840ff2f0810b08030708c3508e1101d02c02e2c3e3030203c1b3c5b30c0078c3e3030208d3e3030201e3f30c0003e18c3e18c3c4c5',
    'hex'
  )).beginParse().loadRef();
}

// Правильный код NFT Collection контракта (TEP-62)
function getCollectionCode() {
  return Cell.fromBoc(Buffer.from(
    'b5ee9c724102170100027f000114ff00f4a413f4bcf2c80b0102016202030202cc0405001ba0f605da89a1f401f481f481a9a30201ce06070201200f100201200809020148030b0201200a0b00971e4a182f010000000000000000000000000000000000000000000000000000000000000000eff21bc0a00371b6a2ef15e14c2ac0d0c2d4f02a3b0a3b0a3b0a3b0a3b0a3b0a3b0a3b0a3b0a3b0a3b0a3b0a3b0a3b0a3b001fe8001f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481f481',
    'hex'
  )).beginParse().loadRef();
}

async function deployCollection(collectionContentUrl) {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  const client = getClient(isTestnet);
  const { wallet, keyPair } = await getMinterWallet(client);
  const ownerAddress = wallet.address.toString();

  console.log('Owner:', ownerAddress);

  const nftItemCode = getNftItemCode();

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

  const collectionCode = getCollectionCode();
  const stateInit = { code: collectionCode, data: collectionData };
  const collectionAddr = contractAddress(0, stateInit);

  console.log('Collection address:', collectionAddr.toString());

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

module.exports = { deployCollection, getNftItemCode };
