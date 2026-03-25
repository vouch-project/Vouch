#!/usr/bin/env node
/**
 * Extracts the ABI array from the Hardhat artifact and writes ABI-only JSON
 * files to packages/abi/. Run automatically as part of `pnpm build`.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../..');

const artifactPath = resolve(__dirname, '../artifacts/contracts/VouchVault.sol/VouchVault.json');

const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
const abiJson = JSON.stringify(artifact.abi, null, 2);

const targets = [resolve(root, 'packages/abi/VouchVault.json'), resolve(root, 'packages/abi/prod/VouchVault.json')];

for (const target of targets) {
  writeFileSync(target, abiJson);
  console.log(`✅ Wrote ABI-only JSON to ${target}`);
}
