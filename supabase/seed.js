import * as dotenv from 'dotenv';
import { Client } from 'pg';
dotenv.config({ path: '../.env' });

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function seed() {
  try {
    await client.connect();
    const contractAddress = process.env.PUBLIC_VOUCH_VAULT_ADDRESS;
    if (!contractAddress) throw new Error('PUBLIC_VOUCH_VAULT_ADDRESS environment variable is not set');

    const infuraProjectId = process.env.INFURA_PROJECT_ID;
    if (infuraProjectId) {
      await client.query(
        `
        INSERT INTO chains ("networkId", "contractAddress", "rpcUrl", "networkType", name)
        VALUES ('1', $1, 'https://mainnet.infura.io/v3/' || $2, 'evm', 'Mainnet')
        ON CONFLICT ("networkId")
        DO UPDATE SET "contractAddress" = EXCLUDED."contractAddress", "rpcUrl" = EXCLUDED."rpcUrl", "networkType" = EXCLUDED."networkType", name = EXCLUDED.name;
        `,
        [contractAddress, infuraProjectId],
      );
    }

    // Insert Sepolia testnet when a Sepolia RPC endpoint is configured.
    const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL;
    if (sepoliaRpcUrl) {
      const sepoliaContractAddress = process.env.SEPOLIA_VOUCH_VAULT_ADDRESS?.trim() || contractAddress;
      await client.query(
        `
        INSERT INTO chains ("networkId", "contractAddress", "rpcUrl", "networkType", name)
        VALUES ('11155111', $1, $2, 'evm', 'Sepolia')
        ON CONFLICT ("networkId")
        DO UPDATE SET "contractAddress" = EXCLUDED."contractAddress", "rpcUrl" = EXCLUDED."rpcUrl", "networkType" = EXCLUDED."networkType", name = EXCLUDED.name;
        `,
        [sepoliaContractAddress, sepoliaRpcUrl],
      );
    }

    // Insert local hardhat only if NODE_ENV is not 'production'
    if (process.env.NODE_ENV !== 'production') {
      await client.query(
        `
        INSERT INTO chains ("networkId", "contractAddress", "rpcUrl", "networkType", name)
        VALUES ('1337', $1, 'http://localhost:8545', 'evm', 'Local Hardhat')
        ON CONFLICT ("networkId")
        DO UPDATE SET "contractAddress" = EXCLUDED."contractAddress", "rpcUrl" = EXCLUDED."rpcUrl", "networkType" = EXCLUDED."networkType", name = EXCLUDED.name;
        `,
        [contractAddress],
      );
    }
  } finally {
    await client.end();
  }
}

seed()
  .then(() => console.log('Seed complete'))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
