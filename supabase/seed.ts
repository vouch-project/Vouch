import * as dotenv from 'dotenv';
import * as path from 'path';
import { Client } from 'pg';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function seed() {
  await client.connect();
  const contractAddress = process.env.PUBLIC_VOUCH_VAULT_ADDRESS;
  if (!contractAddress) throw new Error('PUBLIC_VOUCH_VAULT_ADDRESS environment variable is not set');

  await client.query(
    `
  INSERT INTO chains ("networkId", "contractAddress", "rpcUrl", "networkType", name)
  VALUES (1, $1, 'https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID', 'evm', 'Mainnet')
  ON CONFLICT DO NOTHING;
  `,
    [contractAddress],
  );

  // Insert local hardhat only if NODE_ENV is not 'production'
  if (process.env.NODE_ENV !== 'production') {
    await client.query(
      `
      INSERT INTO chains ("networkId", "contractAddress", "rpcUrl", "networkType", name)
      VALUES (1337, $1, 'ws://localhost:8545', 'evm', 'Local Hardhat')
      ON CONFLICT DO NOTHING;
      `,
      [contractAddress],
    );
  }
  await client.end();
}

seed()
  .then(() => console.log('Seed complete'))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
