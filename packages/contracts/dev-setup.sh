#!/bin/bash

# 1. Define paths
ABI_DEST="../../apps/web/src/lib/abi"
ARTIFACTS="./artifacts/contracts"

# 2. Run the deployment
echo "🚀 Starting deployment..."
npx hardhat run scripts/deploy.ts --network localhost

# 3. Check if deployment succeeded
if [ $? -eq 0 ]; then
    echo "✅ Deployment successful. Copying ABIs..."

    # Ensure directory exists
    mkdir -p "$ABI_DEST"

    # Find and copy ABIs (excluding debug files and mock files)
    find "$ARTIFACTS" -name "*.json" ! -name "*.dbg.json" ! -name "*Mock*.json" -exec cp {} "$ABI_DEST" \;

    echo "📂 ABIs synced to web app."

    # Deploy mock ERC20 for testing (after ABIs and .env are updated)
    npx hardhat run scripts/deploy-mock-erc20.ts --network localhost

    # Pass the mock ERC20 address from .env as an environment variable
    MOCK_ERC20_ADDRESS=$(grep HARDCODED_MOCK_ERC20_ADDRESS ../../.env | cut -d '=' -f2 | tr -d '\r\n')
    HARDCODED_MOCK_ERC20_ADDRESS="$MOCK_ERC20_ADDRESS" npx hardhat run scripts/mint-mock-to-wallets.ts --network localhost
else
    echo "❌ Deployment failed. Skipping ABI sync."
    exit 1
fi