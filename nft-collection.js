const { TonClient, WalletContractV4, internal, toNano, Address, beginCell, Cell, contractAddress } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');

// NFT Collection contract code (TEP-62 standard)
// This is the standard NFT collection contract from TON core team
const COLLECTION_CODE_HEX = 'b5ee9c72410213010002d4000114ff00f4a413f4bcf2c80b0102016202030202cc0405001ba0f605da89a1f401f481f481a9a30201ce06070201580a0b02f70831c02497c138007434c0c05c6c2544d7c0fc03383e903e900c7e800c5c75c87e800c7e800c00b4c7e08403e29fa954882ea54c4d167c0238208405e3514654882ea58c511100fc02780d60841657c1ef2ea4d67c02b817c12103fcbc2000113e910c1c2ebcb853600201200c0d00c9a0000100230092c31c0406500003e900d5c3000148048023db3c05a0cbe1e8698180b8d8492f81f07d201876a2687d007d207d20187800900930008e5d0be9ac72c3e81b72c3e8122cf2c2e8122cf2c2e9ed44d0fa00fa40fa40d4d30041e80403d207d2000905ceb2e8018210d53276db103f5340708210dca7f36610a35140835d27c085232cf16c9ed54f80f21'

function getCollectionCode() {
  return Cell.fromHex(COLLECTION_CODE_HEX);
}

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

// Build NFT collection data cell
function buildCollectionData(ownerAddress, collectionContentUrl, nftItemCodeCell) {
  return beginCell()
    .storeAddress(Address.parse(ownerAddress))
    .storeUint(0, 64) // next_item_index
    .storeRef(
      beginCell()
        .storeUint(1, 8) // off-chain content prefix
        .storeStringTail(collectionContentUrl)
        .endCell()
    )
    .storeRef(nftItemCodeCell)
    .storeRef(beginCell().endCell()) // royalty params (empty)
    .endCell();
}

// Standard NFT item code (TEP-62)
const NFT_ITEM_CODE_HEX = 'b5ee9c7241020d010001fb000114ff00f4a413f4bcf2c80b0102016202030202cc0405001ba0f605da89a1f401f481f481a9a30201ce06070201200b0c02f70831c02497c138007434c0c05c6c2544d7c0fc02a687d207d2070c0a0b488208208a7f74c17c8cbff13cb1fc9ed54f80f21d0d30001f2a1de22d70b01c300209206a19136e220c2fff2e2c502c300105e5f21d70b2502c7008208989680aa008208989680a0a014bcf2e2c504c3ff12f118112e12101a120c1a12d192103d050a05c10a58103d05101a00f0c0092a88213a182104fcbb72f1ba8e48209c2082104fcbb72f1ba8e20821050c4a0ce37c145501c34b00f8208208a7f74c17c8cbff12cb1f12cb3fcb7fcb1f21cf0021fa02ca00c98100a0fb00e05f06840ff2f0006d9040d721fa0031fa0031d7558e118102d31f0131d430d1839d820b90008af8208209c9c380a7f74c17c8cbff5003fa0201cf165004cf16ca0021fa02ca00c9c8ca0040048307fb00007a8e35d33f323232c15401b3e202926c21e2b3e3025f03840ff2f0810b08030708c3508e1101d02c02e2c3e3030203c1b3c5b30c0078c3e3030208d3e3';

function getNftItemCode() {
  return Cell.fromHex(NFT_ITEM_CODE_HEX);
}

async function deployCollection(collectionContentUrl) {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  const client = getClient(isTestnet);
  const { wallet, keyPair } = await getMinterWallet(client);
  const ownerAddress = wallet.address.toString();

  const nftItemCode = getNftItemCode();
  const collectionData = buildCollectionData(ownerAddress, collectionContentUrl, nftItemCode);
  const collectionCode = getCollectionCode();

  const collectionAddr = contractAddress(0, {
    code: collectionCode,
    data: collectionData
  });

  console.log('Collection address:', collectionAddr.toString());

  const seqno = await wallet.getSeqno();
  await wallet.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to: collectionAddr,
        value: toNano('0.1'),
        init: { code: collectionCode, data: collectionData },
        body: beginCell().endCell(),
        bounce: false
      })
    ]
  });

  console.log('Collection deployed!');
  return collectionAddr.toString();
}

module.exports = { deployCollection, getNftItemCode, getCollectionCode };
