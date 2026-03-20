// scripts/sync-prod-abi.js
// Copies the latest VouchVault ABI to the production ABI location after a successful upgrade.

const fs = require('fs');
const path = require('path');

const devAbiPath = path.resolve(__dirname, '../apps/web/src/abi/VouchVault.json');
const prodAbiPath = path.resolve(__dirname, '../apps/web/src/abi/prod/VouchVault.json');

if (!fs.existsSync(devAbiPath)) {
  console.error('Dev ABI not found:', devAbiPath);
  process.exit(1);
}

fs.copyFileSync(devAbiPath, prodAbiPath);
console.log('✅ Synced ABI to production location:', prodAbiPath);
