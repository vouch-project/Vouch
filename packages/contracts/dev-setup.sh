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
    
    # Find and copy ABIs (excluding debug files)
    find "$ARTIFACTS" -name "*.json" ! -name "*.dbg.json" -exec cp {} "$ABI_DEST" \;
    
    echo "📂 ABIs synced to web app."
else
    echo "❌ Deployment failed. Skipping ABI sync."
    exit 1
fi