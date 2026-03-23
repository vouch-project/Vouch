import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LoanService } from '../loan/loan.service';
import { Database } from '../supabase/database.types';
import { SupabaseService } from '../supabase/supabase.service';

const abiPath =
  process.env.NODE_ENV === 'production'
    ? join(__dirname, '../../../../packages/abi/prod/VouchVault.json')
    : join(__dirname, '../../../../packages/abi/VouchVault.json');

const VouchVaultAbi = JSON.parse(readFileSync(abiPath, 'utf-8')) as {
  abi: ethers.InterfaceAbi;
};

type ChainConfig = Database['public']['Tables']['chains']['Row'];

@Injectable()
export class BlockchainListenerService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainListenerService.name);
  private chains: {
    config: ChainConfig;
    provider: ethers.JsonRpcProvider | ethers.WebSocketProvider;
    contract: ethers.Contract;
    network: ethers.Network;
  }[] = [];

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly loanService: LoanService,
  ) {}

  async onModuleInit() {
    const { data: chainConfigs, error } = await this.supabaseService.client
      .from('chains')
      .select('*');

    if (error) {
      this.logger.error('Failed to fetch chain configs from database', error);
      process.exit(1);
    }

    for (const config of chainConfigs) {
      try {
        const provider = config.rpcUrl.startsWith('ws')
          ? new ethers.WebSocketProvider(config.rpcUrl)
          : new ethers.JsonRpcProvider(config.rpcUrl);
        const network = await provider.getNetwork();

        this.logger.log(
          `Connected to chain: ${network.chainId} (${network.name}) [${config.rpcUrl}]`,
        );

        if (provider instanceof ethers.JsonRpcProvider)
          provider.pollingInterval = 4000;

        const contract = new ethers.Contract(
          config.contractAddress,
          VouchVaultAbi.abi,
          provider,
        );
        this.chains.push({ config, provider, contract, network });
        this.setupEventListener(contract, network, config);
      } catch (error) {
        this.logger.error(
          `Failed to connect to RPC at ${config.rpcUrl}: ${(error as Error).message}`,
        );
      }
    }
  }

  private setupEventListener(
    contract: ethers.Contract,
    network: ethers.Network,
    config: ChainConfig,
  ) {
    this.logger.log(
      `Listening for LoanCreated events on chain ${network.chainId} (${network.name})...`,
    );
    void contract.on(
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
          network,
          config.contractAddress,
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
    {
      transactionHash,
      blockNumber,
      blockHash,
      index: logIndex,
    }: ethers.EventLog,
    network: ethers.Network,
    contractAddress: string,
  ) {
    try {
      await this.loanService.create({
        loanId: loanId.toString(),
        borrower,
        collateralAmount: collateralAmount.toString(),
        collateralTokenAddress,
        collateralTxHash: transactionHash,
        collateralBlockNumber: blockNumber.toString(),
        collateralBlockHash: blockHash,
        collateralLockedAt: new Date(Number(timestamp) * 1000).toISOString(),
        networkId: network.chainId.toString(),
        contractAddress,
        logIndex,
      });
    } catch (error) {
      this.logger.error('Failed to create loan in DB', error);
    }
  }
}
