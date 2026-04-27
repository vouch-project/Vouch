#!/bin/bash


# 1. Define paths
ABI_DEST="../../packages/abi"

# 2. Run the deployment
echo "🚀 Starting deployment..."
npx hardhat run scripts/deploy.ts --network localhost

# 3. Check if deployment succeeded
if [ $? -eq 0 ]; then
    echo "✅ Deployment successful. Copying ABIs..."

    # Ensure directory exists
    mkdir -p "$ABI_DEST"

    # Extract ABI-only JSON (strips bytecode/metadata from Hardhat artifacts)
    node scripts/extract-abi.mjs

    echo "📂 ABIs synced to web app."

    # Deploy mock ERC20 for testing (after ABIs and .env are updated)
    npx hardhat run scripts/deploy-mock-erc20.ts --network localhost

    # Pass the mock ERC20 address from .env as an environment variable
    MOCK_ERC20_ADDRESS=$(grep HARDCODED_MOCK_ERC20_ADDRESS ../../.env | cut -d '=' -f2 | tr -d '\r\n')
    HARDCODED_MOCK_ERC20_ADDRESS="$MOCK_ERC20_ADDRESS" npx hardhat run scripts/mint-mock-to-wallets.ts --network localhost

    # Write deployment timestamp so other services know to reload
    TIMESTAMP=$(date +%s%3N)
    ENV_FILE="../../.env"
    if grep -q '^CONTRACTS_DEPLOYED_AT=' "$ENV_FILE"; then
        sed -i '' "s/^CONTRACTS_DEPLOYED_AT=.*/CONTRACTS_DEPLOYED_AT=$TIMESTAMP/" "$ENV_FILE"
    else
        printf '\nCONTRACTS_DEPLOYED_AT=%s\n' "$TIMESTAMP" >> "$ENV_FILE"
    fi
    echo "🕐 CONTRACTS_DEPLOYED_AT=$TIMESTAMP written to .env"
else
    echo "❌ Deployment failed. Skipping ABI sync."
    exit 1
fi