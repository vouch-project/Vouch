import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Tables } from '@vouch/database-types';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LoansService } from '../loans/loans.service';
import { SupabaseService } from '../supabase/supabase.service';

type ChainConfig = Tables<'chains'>;

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
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly loanService: LoansService,
  ) {}

  async onModuleInit() {
    const abiPath =
      this.configService.get('NODE_ENV') === 'production'
        ? join(__dirname, '../../../../packages/abi/prod/VouchVault.json')
        : join(__dirname, '../../../../packages/abi/VouchVault.json');

    const VouchVaultAbi = JSON.parse(
      readFileSync(abiPath, 'utf-8'),
    ) as ethers.InterfaceAbi;

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
          VouchVaultAbi,
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

  // Serializes event processing per chain so handlers run in arrival order.
  // Without this, ethers fires listeners concurrently and a LoanPartiallyRepaid
  // can be processed before the corresponding LoanFunded write completes,
  // leaving lenderAddress NULL when the repayment RPC needs it.
  private eventQueues = new Map<string, Promise<void>>();

  private enqueue(key: string, task: () => Promise<void>) {
    const prev = this.eventQueues.get(key) ?? Promise.resolve();
    // Ignore the previous task's outcome so one failure can't poison the chain,
    // then run this task and swallow+log any rejection to avoid an unhandled
    // rejection leaving the queue permanently rejected.
    const next = prev
      .catch(() => undefined)
      .then(task)
      .catch((err) => {
        this.logger.error(`Unhandled error in event queue for ${key}`, err);
      });
    this.eventQueues.set(key, next);
  }

  private setupEventListener(
    contract: ethers.Contract,
    network: ethers.Network,
    config: ChainConfig,
  ) {
    this.logger.log(
      `Listening for events on chain ${network.chainId} (${network.name})...`,
    );

    const queueKey = `${network.chainId.toString()}:${config.contractAddress}`;

    void contract.on(
      'LoanCreated',
      (
        loanId: bigint,
        borrower: string,
        collateralTokenAddress: string,
        collateralAmount: bigint,
        requestedPrincipalToken: string,
        requestedPrincipalAmount: bigint,
        timestamp: bigint,
        { log: eventLog }: ethers.ContractEventPayload,
      ) => {
        this.enqueue(queueKey, () =>
          this.handleLoanCreated(
            loanId,
            borrower,
            collateralTokenAddress,
            collateralAmount,
            requestedPrincipalToken,
            requestedPrincipalAmount,
            timestamp,
            eventLog,
            network,
            config.contractAddress,
          ),
        );
      },
    );

    void contract.on(
      'LoanFunded',
      (
        loanId: bigint,
        lender: string,
        borrower: string,
        principalAmount: bigint,
        timestamp: bigint,
        { log: eventLog }: ethers.ContractEventPayload,
      ) => {
        this.enqueue(queueKey, () =>
          this.handleLoanFunded(
            loanId,
            lender,
            borrower,
            principalAmount,
            timestamp,
            eventLog,
            network,
            config.contractAddress,
          ),
        );
      },
    );

    void contract.on(
      'LoanRepaid',
      (
        loanId: bigint,
        borrower: string,
        lender: string,
        principalAmount: bigint,
        interestAmount: bigint,
        totalRepaid: bigint,
        timestamp: bigint,
        { log: eventLog }: ethers.ContractEventPayload,
      ) => {
        this.enqueue(queueKey, () =>
          this.handleLoanRepaid(
            loanId,
            borrower,
            lender,
            principalAmount,
            interestAmount,
            totalRepaid,
            timestamp,
            eventLog,
            network,
            config.contractAddress,
          ),
        );
      },
    );

    void contract.on(
      'LoanPartiallyRepaid',
      (
        loanId: bigint,
        borrower: string,
        paymentAmount: bigint,
        _collateralReleased: bigint,
        _totalRepaidSoFar: bigint,
        _totalDue: bigint,
        timestamp: bigint,
        { log: eventLog }: ethers.ContractEventPayload,
      ) => {
        this.enqueue(queueKey, () =>
          this.handleLoanPartiallyRepaid(
            loanId,
            borrower,
            paymentAmount,
            timestamp,
            eventLog,
            network,
            config.contractAddress,
          ),
        );
      },
    );
  }

  private async handleLoanCreated(
    loanId: bigint,
    borrower: string,
    collateralTokenAddress: string,
    collateralAmount: bigint,
    requestedPrincipalToken: string,
    requestedPrincipalAmount: bigint,
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
        loanId: loanId,
        borrower,
        collateralAmount: collateralAmount,
        collateralTokenAddress,
        requestedPrincipalTokenAddress: requestedPrincipalToken,
        requestedPrincipalAmount: requestedPrincipalAmount,
        collateralTxHash: transactionHash,
        collateralBlockNumber: blockNumber,
        collateralBlockHash: blockHash,
        collateralLockedAt: new Date(Number(timestamp) * 1000),
        networkId: network.chainId.toString(),
        contractAddress,
        logIndex,
      });
    } catch (error) {
      this.logger.error('Failed to create loan in DB', error);
    }
  }

  private async handleLoanFunded(
    loanId: bigint,
    lender: string,
    borrower: string,
    principalAmount: bigint,
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
      await this.loanService.fund({
        onChainLoanId: loanId,
        networkId: network.chainId.toString(),
        contractAddress,
        lenderAddress: lender,
        borrowerAddress: borrower,
        principalAmount,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        fundedAt: new Date(Number(timestamp) * 1000),
      });
      this.logger.log(`Loan ${loanId.toString()} funded by ${lender}`);
    } catch (error) {
      this.logger.error('Failed to update funded loan in DB', error);
    }
  }

  private async handleLoanPartiallyRepaid(
    loanId: bigint,
    borrower: string,
    paymentAmount: bigint,
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
      await this.loanService.partialRepay({
        onChainLoanId: loanId,
        networkId: network.chainId.toString(),
        contractAddress,
        borrowerAddress: borrower,
        paymentAmount,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        paidAt: new Date(Number(timestamp) * 1000),
      });
      this.logger.log(
        `Loan ${loanId.toString()} partial repayment of ${paymentAmount.toString()} by ${borrower}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to record partial repayment for loan ${loanId.toString()}`,
        error,
      );
    }
  }

  private async handleLoanRepaid(
    loanId: bigint,
    borrower: string,
    lender: string,
    principalAmount: bigint,
    interestAmount: bigint,
    totalRepaid: bigint,
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
      await this.loanService.repay({
        onChainLoanId: loanId,
        networkId: network.chainId.toString(),
        contractAddress,
        borrowerAddress: borrower,
        lenderAddress: lender,
        principalAmount,
        interestAmount,
        totalRepaid,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        repaidAt: new Date(Number(timestamp) * 1000),
      });
      this.logger.log(`Loan ${loanId.toString()} repaid by ${borrower}`);
    } catch (error) {
      this.logger.error(
        `Failed to mark loan ${loanId.toString()} as repaid in DB`,
        error,
      );
    }
  }
}
