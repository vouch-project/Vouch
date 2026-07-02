import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import { HardhatUserConfig } from 'hardhat/config';

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
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 1337,
    },
  },
};

export default config;
