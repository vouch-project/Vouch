import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Tables } from '@vouch/database-types';
import { VouchVault__factory } from '@vouch/contracts';
import type { VouchVault } from '@vouch/contracts';
import { ethers } from 'ethers';
import { LoansService } from '../loans/loans.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SerialQueue } from './serial-queue';

type ChainConfig = Tables<'chains'>;

@Injectable()
export class BlockchainListenerService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainListenerService.name);
  private chains: {
    config: ChainConfig;
    provider: ethers.JsonRpcProvider | ethers.WebSocketProvider;
    contract: VouchVault;
    network: ethers.Network;
  }[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly loanService: LoansService,
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

        const contract = VouchVault__factory.connect(
          config.contractAddress,
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

  // Serializes event processing per chain so handlers run in arrival order
  // (see SerialQueue). Without this, ethers fires listeners concurrently and a
  // LoanPartiallyRepaid can be processed before the corresponding LoanFunded
  // write completes, leaving lenderAddress NULL when the repayment RPC needs it.
  private readonly queue = new SerialQueue((key, err) =>
    this.logger.error(`Unhandled error in event queue for ${key}`, err),
  );

  private enqueue(key: string, task: () => Promise<void>) {
    this.queue.enqueue(key, task);
  }

  private setupEventListener(
    contract: VouchVault,
    network: ethers.Network,
    config: ChainConfig,
  ) {
    this.logger.log(
      `Listening for events on chain ${network.chainId} (${network.name})...`,
    );

    const queueKey = `${network.chainId.toString()}:${config.contractAddress}`;

    void contract.on(
      contract.filters.LoanCreated(),
      (
        loanId,
        borrower,
        collateralTokenAddress,
        collateralAmount,
        requestedPrincipalToken,
        requestedPrincipalAmount,
        timestamp,
        event,
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
            event,
            network,
            config.contractAddress,
            contract,
          ),
        );
      },
    );

    void contract.on(
      contract.filters.LoanFunded(),
      (loanId, lender, borrower, principalAmount, timestamp, event) => {
        this.enqueue(queueKey, () =>
          this.handleLoanFunded(
            loanId,
            lender,
            borrower,
            principalAmount,
            timestamp,
            event,
            network,
            config.contractAddress,
          ),
        );
      },
    );

    void contract.on(
      contract.filters.LoanRepaid(),
      (
        loanId,
        borrower,
        lender,
        principalAmount,
        interestAmount,
        totalRepaid,
        timestamp,
        event,
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
            event,
            network,
            config.contractAddress,
          ),
        );
      },
    );

    void contract.on(
      contract.filters.LoanPartiallyRepaid(),
      (
        loanId,
        borrower,
        paymentAmount,
        _collateralReleased,
        _totalRepaidSoFar,
        _totalDue,
        timestamp,
        event,
      ) => {
        this.enqueue(queueKey, () =>
          this.handleLoanPartiallyRepaid(
            loanId,
            borrower,
            paymentAmount,
            timestamp,
            event,
            network,
            config.contractAddress,
          ),
        );
      },
    );

    void contract.on(
      contract.filters.LoanCancelled(),
      (loanId, borrower, timestamp, event) => {
        this.enqueue(queueKey, () =>
          this.handleLoanCancelled(
            loanId,
            borrower,
            timestamp,
            event,
            network,
            config.contractAddress,
          ),
        );
      },
    );
  }

  protected async handleLoanCreated(
    loanId: bigint,
    borrower: string,
    collateralTokenAddress: string,
    collateralAmount: bigint,
    requestedPrincipalToken: string,
    requestedPrincipalAmount: bigint,
    timestamp: bigint,
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
    network: ethers.Network,
    contractAddress: string,
    contract: VouchVault,
  ) {
    let interestRateBps = 0;
    let durationSeconds = 0;
    let fundWindowSeconds = 0;
    try {
      const details = await contract.getRepaymentDetails(loanId);
      interestRateBps = Number(details.interestRateBps);
      durationSeconds = Number(details.durationSeconds);
      fundWindowSeconds = Number(details.fundDeadline - timestamp);
    } catch (error) {
      this.logger.error('Failed to read loan terms from contract', error);
    }

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
        interestRateBps,
        durationSeconds,
        fundWindowSeconds,
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
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
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

  protected async handleLoanCancelled(
    loanId: bigint,
    borrower: string,
    timestamp: bigint,
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
    network: ethers.Network,
    contractAddress: string,
  ) {
    try {
      await this.loanService.cancel({
        onChainLoanId: loanId,
        networkId: network.chainId.toString(),
        contractAddress,
        borrowerAddress: borrower,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        cancelledAt: new Date(Number(timestamp) * 1000),
      });
      this.logger.log(`Loan ${loanId.toString()} cancelled by ${borrower}`);
    } catch (error) {
      this.logger.error('Failed to cancel loan in DB', error);
    }
  }

  protected async handleLoanPartiallyRepaid(
    loanId: bigint,
    borrower: string,
    paymentAmount: bigint,
    timestamp: bigint,
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
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
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
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
