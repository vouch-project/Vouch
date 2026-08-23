import { ethers } from 'ethers';

/**
 * Generate a fresh keypair for SCORE_SIGNER_PRIVATE_KEY.
 *
 * The API (apps/api scoring.service.ts) signs EIP-712 score/LTV attestations
 * with this private key, and the deploy script derives its address to set as
 * the on-chain `scoreSigner`. This just needs to be a random Ethereum key.
 *
 * Usage:
 *   npx ts-node packages/contracts/scripts/generate-score-signer.ts
 */
function main(): void {
  const wallet = ethers.Wallet.createRandom();

  console.log('Generated score signer keypair:\n');
  console.log(`  Address:     ${wallet.address}`);
  console.log(`  Private key: ${wallet.privateKey}\n`);
  console.log('Add this to your .env (keep the private key secret):\n');
  console.log(`SCORE_SIGNER_PRIVATE_KEY=${wallet.privateKey}`);
}

main();
