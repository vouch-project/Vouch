import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

const abiPath =
  process.env.NODE_ENV === 'production'
    ? join(__dirname, '../../../../packages/abi/prod/VouchVault.json')
    : join(__dirname, '../../../../packages/abi/VouchVault.json');

const VouchVaultAbi = JSON.parse(readFileSync(abiPath, 'utf-8')) as {
  abi: ethers.InterfaceAbi;
};

@Injectable()
export class BlockchainListenerService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainListenerService.name);
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private contractAddress: string;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const rpcUrl =
      this.configService.get<string>('RPC_URL') ?? 'http://localhost:8545';
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.contractAddress =
      this.configService.get<string>('PUBLIC_VOUCH_VAULT_ADDRESS') ?? '';

    try {
      // In v6, this is how you check if the provider is actually connected
      const network = await this.provider.getNetwork();
      this.logger.log(
        `Connected to chain: ${network.chainId} (${network.name})`,
      );

      // Hardhat HTTP polling can be slow (default is 4s).
      // Speed it up for local dev:
      this.provider.pollingInterval = 500;

      this.setupEventListener();
    } catch (error) {
      this.logger.error(
        `Failed to connect to RPC at ${rpcUrl}: ${(error as Error).message}`,
      );
    }
  }

  private setupEventListener() {
    // Use a WebSocket provider (wss://) for real-time, low-latency listening
    this.contract = new ethers.Contract(
      this.contractAddress,
      VouchVaultAbi.abi,
      this.provider,
    );

    this.logger.log('Listening for LoanCreated events...');

    // The actual listener
    void this.contract.on(
      'LoanCreated',
      (
        user: string,
        amount: string,
        collateralToken: string,
        collateralAmount: string,
        { transactionHash }: ethers.EventLog,
      ) => {
        this.handleLoanCreated(
          user,
          BigInt(amount),
          collateralToken,
          BigInt(collateralAmount),
          transactionHash,
        );
      },
    );
  }

  private handleLoanCreated(
    user: string,
    amount: bigint,
    collateralToken: string,
    collateralAmount: bigint,
    txHash: string,
  ) {
    this.logger.log(
      `New Loan! User: ${user}, Amount: ${ethers.formatEther(amount)}, Collateral Token: ${collateralToken}, Collateral Amount: ${ethers.formatEther(collateralAmount)}, TxHash: ${txHash}`,
    );
    this.logger.log(
      `Full event data: ${JSON.stringify({ user, amount, collateralToken, collateralAmount, txHash })}`,
    );

    // TODO: Update your database (TypeORM/Prisma) here
    // await this.loansService.create({ user, amount, collateralToken, collateralAmount, txHash });
  }
}
