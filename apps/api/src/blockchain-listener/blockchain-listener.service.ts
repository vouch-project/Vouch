import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LoanService } from '../loan/loan.service';

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
  private provider: ethers.JsonRpcProvider | ethers.WebSocketProvider;
  private contract: ethers.Contract;
  private contractAddress: string;
  private network: ethers.Network;

  constructor(
    private readonly configService: ConfigService,
    private readonly loanService: LoanService,
  ) {}

  async onModuleInit() {
    const rpcUrl =
      this.configService.get<string>('RPC_URL') ?? 'ws://localhost:8545';
    this.provider = rpcUrl.startsWith('ws')
      ? new ethers.WebSocketProvider(rpcUrl)
      : new ethers.JsonRpcProvider(rpcUrl);

    this.contractAddress =
      this.configService.get<string>('PUBLIC_VOUCH_VAULT_ADDRESS') ?? '';

    try {
      this.network = await this.provider.getNetwork();
      this.logger.log(
        `Connected to chain: ${this.network.chainId} (${this.network.name})`,
      );

      if (this.provider instanceof ethers.JsonRpcProvider)
        this.provider.pollingInterval = 500;

      this.setupEventListener();
    } catch (error) {
      this.logger.error(
        `Failed to connect to RPC at ${rpcUrl}: ${(error as Error).message}`,
      );
    }
  }

  private setupEventListener() {
    this.contract = new ethers.Contract(
      this.contractAddress,
      VouchVaultAbi.abi,
      this.provider,
    );

    this.logger.log('Listening for LoanCreated events...');

    void this.contract.on(
      'LoanCreated',
      (
        loanId: bigint,
        borrower: string,
        collateralTokenAddress: string,
        collateralAmount: bigint,
        timestamp: bigint,
        { log: eventLog }: ethers.ContractEventPayload,
      ) => {
        void this.handleLoanCreated(
          loanId,
          borrower,
          collateralTokenAddress,
          collateralAmount,
          timestamp,
          eventLog,
        );
      },
    );
  }

  private async handleLoanCreated(
    loanId: bigint,
    borrower: string,
    collateralTokenAddress: string,
    collateralAmount: bigint,
    timestamp: bigint,
    eventLog: ethers.EventLog,
  ) {
    try {
      await this.loanService.create({
        loanId: loanId.toString(),
        borrower,
        collateralAmount: collateralAmount.toString(),
        collateralTokenAddress,
        collateralTxHash: eventLog.transactionHash,
        collateralBlockNumber: eventLog.blockNumber.toString(),
        collateralBlockHash: eventLog.blockHash,
        collateralLockedAt: new Date(Number(timestamp) * 1000).toISOString(),
        chainId: this.network.chainId.toString(),
      });
    } catch (error) {
      this.logger.error('Failed to create loan in DB', error);
    }
  }
}
