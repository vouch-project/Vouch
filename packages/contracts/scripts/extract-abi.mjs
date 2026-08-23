#!/usr/bin/env node
/**
 * Extracts the ABI array from each Hardhat artifact and writes ABI-only JSON
 * files to packages/abi/. Run automatically as part of `pnpm build`. These
 * language-neutral ABIs are the single source of truth for non-TS consumers
 * (e.g. the Python keeper), so add every contract a consumer needs to reach here.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../..');

const CONTRACTS = ['VouchVault', 'VouchVaultLens'];

for (const name of CONTRACTS) {
  const artifactPath = resolve(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const abiJson = JSON.stringify(artifact.abi, null, 2);

  const target = resolve(root, `packages/abi/${name}.json`);
  writeFileSync(target, abiJson);
  console.log(`✅ Wrote ABI-only JSON to ${target}`);
}
