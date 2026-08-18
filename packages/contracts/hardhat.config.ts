import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import * as dotenv from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';
import path from 'path';

// Load the monorepo root .env so network RPC URLs / keys are available at
// config-evaluation time (network `accounts` are read when this file loads).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
      // Mine a block every 10s so block.timestamp advances in real time on the
      // local chain, letting interest accrual be observed without sending txs.
      // 10s keeps the clock within the UI's 30s poll window while avoiding a
      // flood of empty blocks. Local-only: no effect on real deployments.
      mining: {
        auto: true,
        interval: 10000,
      },
      // Allow contract deployments that exceed the Spurious Dragon 24 KiB limit
      // so that tests pass locally. This limit is not enforced by the Hardhat
      // in-process network by default; we opt in here while the contract is
      // large but still deployable on networks with custom limits (e.g. L2s).
      allowUnlimitedContractSize: true,
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 1337,
    },
    sepolia: (() => {
      const cliNetworkEq = process.argv.find((arg) => arg.startsWith('--network='));
      const cliNetwork =
        cliNetworkEq?.split('=')[1] ??
        (() => {
          const idx = process.argv.findIndex((arg) => arg === '--network');
          const next = idx >= 0 ? process.argv[idx + 1] : undefined;
          return next && !next.startsWith('-') ? next : undefined;
        })();
      const network = (cliNetwork ?? process.env.HARDHAT_NETWORK ?? '').toLowerCase();
      if (network === 'sepolia') {
        if (!SEPOLIA_RPC_URL) {
          throw new Error('SEPOLIA_RPC_URL is required when running with --network sepolia (see .env.example).');
        }
        if (!DEPLOYER_PRIVATE_KEY) {
          throw new Error('DEPLOYER_PRIVATE_KEY is required when running with --network sepolia (see .env.example).');
        }
        if (!/^0x[0-9a-fA-F]{64}$/.test(DEPLOYER_PRIVATE_KEY)) {
          throw new Error('DEPLOYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string (see .env.example).');
        }
      }

      return {
        url: SEPOLIA_RPC_URL ?? '',
        chainId: 11155111,
        accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      };
    })(),
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY ?? '',
  },
};

export default config;
