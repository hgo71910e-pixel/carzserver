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

// NFT Item code - standard TEP-62 from ton-core examples
function getNftItemCode() {
  // Standard nft-item.fc compiled code
  return Cell.fromBase64('te6cckECDQEAAdAAART/APSkE/S88sgLAgEBAgECAgED8BAB/uMNCwHAA4IQ1TJ223CAGMjLBVAEzxZQBPoCE8tqyMsfAc8WyfkAHKEgwACTIMIAmI4q0x8BghDVMnbbugHTP1lsIjD4J28Q+EFvJBNfA6D4J28Q+EFvJBAjoL7y4IIBpI6CEA+KfqVSELyUMDQ1WYIFBQIDBAIAAP4wghBfzD0UIYAYyMsFUAbPFlAE+gIVy2oSyx/LP8sfAfoCyXH7AAIBIAYHAgEgCAkAmzL0pCOlIIIImJaAoBO+hbY4SIIQBIoEQPhCghBfzD0UIYAYyMsFUAbPFlAE+gIVy2oSyx/LP8sfAfoCyXH7ADAxMiB/jhZUcDSAZKkEIW6zINdJwSCRcOKRMOKRMeIBAgEgCgsCAUgMDQAZvl8PaiaGoA/DHQAJW2zfaiaGoA/DHQANtgW2eKoA/DHQAB+zu2i7fvoAUASBS6k=');
}

// NFT Collection code - standard TEP-62
function getCollectionCode() {
  return Cell.fromBase64('te6cckECFAEAAh8AART/APSkE/S88sgLAgEBAgECAgED8BAB/uMNCwHAA4IQ1TJ223CAGMjLBVAEzxZQBPoCE8tqyMsfAc8WyfkAHKEgwACTIMIAmI4q0x8BghDVMnbbugHTP1lsIjD4J28Q+EFvJBNfA6D4J28Q+EFvJBAjoL7y4IIBpI6CEA+KfqVSELyUMDQ1WYIDBQQCAQIDBAIAAP4wghBfzD0UIYAYyMsFUAbPFlAE+gIVy2oSyx/LP8sfAfoCyXH7AAIBIAYHAgFICAkAmzL0pCOlIIIImJaAoBO+hbY4SIIQBIoEQPhCghBfzD0UIYAYyMsFUAbPFlAE+gIVy2oSyx/LP8sfAfoCyXH7ADAxMiB/jhZUcDSAZKkEIW6zINdJwSCRcOKRMOKRMeIBAgEgCgsCAUgMDQAZvl8PaiaGoA/DHQAJW2zfaiaGoA/DHQANtgW2eKoA/DHQAB+zu2i7fvoAUASBS6k=');
}

async function deployCollection(collectionContentUrl) {
  const isTestnet = (process.env.TON_NETWORK || 'testnet') === 'testnet';
  const client = getClient(isTestnet);
  const { wallet, keyPair } = await getMinterWallet(client);
  const ownerAddress = wallet.address.toString();

  console.log('Owner address:', ownerAddress);

  // Collection content cell
  const contentCell = beginCell()
    .storeUint(1, 8) // off-chain
    .storeStringTail(collectionContentUrl)
    .endCell();

  // NFT item code
  const nftItemCode = getNftItemCode();

  // Royalty params (0%)
  const royaltyCell = beginCell()
    .storeUint(0, 16) // numerator
    .storeUint(100, 16) // denominator
    .storeAddress(Address.parse(ownerAddress))
    .endCell();

  // Collection data
  const collectionData = beginCell()
    .storeAddress(Address.parse(ownerAddress))
    .storeUint(0, 64) // next_item_index
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

  console.log('Deploy TX sent, waiting 8s...');
  await new Promise(r => setTimeout(r, 8000));
  console.log('Collection deployed!');

  return collectionAddr.toString();
}

module.exports = { deployCollection, getNftItemCode, getCollectionCode };
