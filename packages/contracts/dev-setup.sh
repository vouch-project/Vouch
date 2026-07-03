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

    # Deploy mock Chainlink price feeds and register them on VouchVault.
    # This script hard-requires DATABASE_URL (it mirrors feed addresses to
    # Postgres) — skip it entirely if a dev is only running contracts/web
    # without local Supabase, rather than let it fail with a stack trace
    # after the deployment above already succeeded.
    if grep -q '^DATABASE_URL=' ../../.env; then
        npx hardhat run scripts/deploy-mock-aggregators.ts --network localhost
    else
        echo "⚠️  DATABASE_URL not set in .env — skipping Chainlink mock price feed setup."
    fi

    # Write deployment timestamp so other services know to reload
    TIMESTAMP=$(node -e "process.stdout.write(String(Date.now()))")
    ENV_FILE="../../.env"
    if grep -q '^CONTRACTS_DEPLOYED_AT=' "$ENV_FILE"; then
        node -e "
          const fs = require('fs');
          const f = '$ENV_FILE';
          fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^CONTRACTS_DEPLOYED_AT=.*/m, 'CONTRACTS_DEPLOYED_AT=$TIMESTAMP'));
        "
    else
        printf '\nCONTRACTS_DEPLOYED_AT=%s\n' "$TIMESTAMP" >> "$ENV_FILE"
    fi
    echo "🕐 CONTRACTS_DEPLOYED_AT=$TIMESTAMP written to .env"
else
    echo "❌ Deployment failed. Skipping ABI sync."
    exit 1
fi