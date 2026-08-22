import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VouchVault } from '@vouch/contracts';
import { VouchVault__factory } from '@vouch/contracts';
import type { Tables } from '@vouch/database-types';
import { ethers } from 'ethers';
import { LoansService } from '../loans/loans.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SerialQueue } from './serial-queue';

type ChainConfig = Tables<'chains'>;

/**
 * ethers v6 invokes contract event listeners with a `ContractEventPayload`, but
 * TypeChain types the final listener argument as a `TypedEventLog`. Resolve the
 * underlying `Log` regardless of which shape arrives at runtime.
 */
const resolveEventLog = (
  event: ethers.Log | ethers.ContractEventPayload,
): ethers.Log =>
  event instanceof ethers.ContractEventPayload ? event.log : event;

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
      const listenerUrl = config.wsRpcUrl ?? config.rpcUrl;
      try {
        const provider = listenerUrl.startsWith('ws')
          ? new ethers.WebSocketProvider(listenerUrl)
          : new ethers.JsonRpcProvider(listenerUrl, undefined, {
              polling: true,
            });
        const network = await provider.getNetwork();

        this.logger.log(
          `Connected to chain: ${network.chainId} (${network.name}) [${listenerUrl}]`,
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
          `Failed to connect to RPC at ${listenerUrl}: ${(error as Error).message}`,
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
      contract.getEvent('LoanCreated'),
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
            resolveEventLog(event),
            network,
            config.contractAddress,
            contract,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('LoanFunded'),
      (loanId, lender, borrower, principalAmount, timestamp, event) => {
        this.enqueue(queueKey, () =>
          this.handleLoanFunded(
            loanId,
            lender,
            borrower,
            principalAmount,
            timestamp,
            resolveEventLog(event),
            network,
            config.contractAddress,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('LoanRepaid'),
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
            resolveEventLog(event),
            network,
            config.contractAddress,
            contract,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('LoanPartiallyRepaid'),
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
            resolveEventLog(event),
            network,
            config.contractAddress,
            contract,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('LoanCancelled'),
      (loanId, borrower, timestamp, event) => {
        this.enqueue(queueKey, () =>
          this.handleLoanCancelled(
            loanId,
            borrower,
            timestamp,
            resolveEventLog(event),
            network,
            config.contractAddress,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('LoanExpired'),
      (loanId, borrower, timestamp, event) => {
        this.enqueue(queueKey, () =>
          this.handleLoanExpired(
            loanId,
            borrower,
            timestamp,
            resolveEventLog(event),
            network,
            config.contractAddress,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('ProtocolFeeCollected'),
      (loanId, _token, amount, event) => {
        this.enqueue(queueKey, () =>
          this.handleProtocolFeeCollected(
            loanId,
            amount,
            resolveEventLog(event),
            network,
            config.contractAddress,
            contract,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('LendOfferCreated'),
      (offerId, lender, principalToken, principalAmount, event) => {
        this.enqueue(queueKey, () =>
          this.handleLendOfferCreated(
            offerId,
            lender,
            principalToken,
            principalAmount,
            resolveEventLog(event),
            network,
            config.contractAddress,
            contract,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('LendOfferAccepted'),
      (offerId, loanId, borrower, event) => {
        this.enqueue(queueKey, () =>
          this.handleLendOfferAccepted(
            offerId,
            loanId,
            borrower,
            resolveEventLog(event),
            network,
            config.contractAddress,
            contract,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('LendOfferCancelled'),
      (offerId, lender, event) => {
        this.enqueue(queueKey, () =>
          this.handleLendOfferCancelled(
            offerId,
            lender,
            resolveEventLog(event),
            network,
            config.contractAddress,
          ),
        );
      },
    );

    void contract.on(
      contract.getEvent('LendOfferExpired'),
      (offerId, event) => {
        this.enqueue(queueKey, () =>
          this.handleLendOfferExpired(
            offerId,
            resolveEventLog(event),
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
    } catch (primaryError) {
      this.logger.error(
        'Failed to read loan terms from getRepaymentDetails; falling back to loans(loanId)',
        primaryError,
      );
      try {
        const loan = await contract.loans(loanId);
        interestRateBps = Number(loan.interestRateBps);
        durationSeconds = Number(loan.durationSeconds);
        fundWindowSeconds = Number(loan.fundDeadline - timestamp);
      } catch (fallbackError) {
        this.logger.error(
          'Failed to read loan terms from loans(); aborting handler',
          fallbackError,
        );
        throw fallbackError;
      }
    }

    if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 0) {
      this.logger.warn(
        `Invalid durationSeconds for loan ${loanId.toString()}: ${durationSeconds}`,
      );
      durationSeconds = 0;
    }
    if (!Number.isSafeInteger(fundWindowSeconds) || fundWindowSeconds < 0) {
      this.logger.warn(
        `Invalid fundWindowSeconds for loan ${loanId.toString()}: ${fundWindowSeconds}`,
      );
      fundWindowSeconds = 0;
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

  protected async handleLoanExpired(
    loanId: bigint,
    borrower: string,
    timestamp: bigint,
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
    network: ethers.Network,
    contractAddress: string,
  ) {
    try {
      await this.loanService.expire({
        onChainLoanId: loanId,
        networkId: network.chainId.toString(),
        contractAddress,
        borrowerAddress: borrower,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        expiredAt: new Date(Number(timestamp) * 1000),
      });
      this.logger.log(`Loan ${loanId.toString()} expired`);
    } catch (error) {
      this.logger.error('Failed to expire loan in DB', error);
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
    contract: VouchVault,
  ) {
    try {
      // principalRepaid/collateralReleased are cumulative, monotonic struct
      // fields not carried by the event; read them live so the DB cache matches
      // the chain exactly.
      const { principalRepaid, collateralReleased } =
        await this.readRepaidAmounts(contract, loanId);
      await this.loanService.partialRepay({
        onChainLoanId: loanId,
        networkId: network.chainId.toString(),
        contractAddress,
        borrowerAddress: borrower,
        paymentAmount,
        principalRepaid,
        collateralReleased,
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
    contract: VouchVault,
  ) {
    try {
      const { principalRepaid, collateralReleased } =
        await this.readRepaidAmounts(contract, loanId);
      await this.loanService.repay({
        onChainLoanId: loanId,
        networkId: network.chainId.toString(),
        contractAddress,
        borrowerAddress: borrower,
        lenderAddress: lender,
        principalAmount,
        interestAmount,
        totalRepaid,
        principalRepaid,
        collateralReleased,
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

  /**
   * Record the protocol fee skimmed from the interest portion of a repayment as
   * its own ledger entry (borrower -> protocolTreasury). The event carries only
   * (loanId, token, amount), so the treasury recipient is read live and the
   * collection time comes from the block. Recorded separately from the lender's
   * gross `repayment` row so lender net receipts and treasury income are both
   * derivable from the transactions ledger.
   */
  protected async handleProtocolFeeCollected(
    loanId: bigint,
    amount: bigint,
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
    network: ethers.Network,
    contractAddress: string,
    contract: VouchVault,
  ) {
    try {
      // The contract is connected with a Provider as its runner, so `runner` is
      // itself the provider (it has no nested `.provider`). Fall back to
      // `runner.provider` only when the runner is a Signer.
      const runner = contract.runner;
      const provider: ethers.Provider | null =
        runner &&
        typeof (runner as Partial<ethers.Provider>).getBlock === 'function'
          ? (runner as ethers.Provider)
          : (runner?.provider ?? null);

      const [treasuryAddress, block] = await Promise.all([
        // ProtocolFeeCollected omits the treasury; read it at the event's block
        // so a later owner-initiated treasury change can't misattribute backlog.
        contract.protocolTreasury({ blockTag: blockNumber }),
        provider ? provider.getBlock(blockNumber) : Promise.resolve(null),
      ]);
      await this.loanService.recordProtocolFee({
        onChainLoanId: loanId,
        networkId: network.chainId.toString(),
        contractAddress,
        treasuryAddress,
        feeAmount: amount,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        collectedAt: new Date(
          (block?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
        ),
      });
      this.logger.log(
        `Protocol fee of ${amount.toString()} collected for loan ${loanId.toString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to record protocol fee for loan ${loanId.toString()}`,
        error,
      );
    }
  }

  protected async handleLendOfferCreated(
    offerId: bigint,
    lender: string,
    principalToken: string,
    principalAmount: bigint,
    { blockNumber }: ethers.Log,
    network: ethers.Network,
    contractAddress: string,
    contract: VouchVault,
  ) {
    let durationSeconds = 0;
    let acceptWindowSeconds = 0;
    let collateralRatioBps = 0;
    let trustedRatioBps = 0;
    let scoreThreshold = 0;
    let maxLtvBps = 0;
    let interestRateBps = 0;
    let createdAt = new Date();

    try {
      const runner = contract.runner;
      const provider: ethers.Provider | null =
        runner &&
        typeof (runner as Partial<ethers.Provider>).getBlock === 'function'
          ? (runner as ethers.Provider)
          : (runner?.provider ?? null);

      const [offer, block] = await Promise.all([
        contract.lendOffers(offerId),
        provider ? provider.getBlock(blockNumber) : Promise.resolve(null),
      ]);

      const createdTimestamp =
        block?.timestamp ?? Math.floor(Date.now() / 1000);
      createdAt = new Date(createdTimestamp * 1000);

      durationSeconds = Number(offer.durationSeconds);
      acceptWindowSeconds = Number(offer.acceptDeadline) - createdTimestamp;
      collateralRatioBps = Number(offer.collateralRatioBps);
      trustedRatioBps = Number(offer.trustedRatioBps);
      scoreThreshold = Number(offer.scoreThreshold);
      maxLtvBps = Number(offer.maxLtvBps);
      interestRateBps = Number(offer.interestRateBps);
    } catch (err) {
      this.logger.error('Failed to read lend offer details from chain', err);
    }

    try {
      await this.loanService.createLendOffer({
        offerId,
        lenderAddress: lender,
        principalTokenAddress: principalToken,
        principalAmount,
        collateralRatioBps,
        trustedRatioBps,
        scoreThreshold,
        maxLtvBps,
        interestRateBps,
        durationSeconds,
        acceptWindowSeconds,
        networkId: network.chainId.toString(),
        contractAddress,
        createdAt,
      });
      this.logger.log(`LendOffer ${offerId.toString()} created by ${lender}`);
    } catch (error) {
      this.logger.error('Failed to create lend offer in DB', error);
    }
  }

  protected async handleLendOfferAccepted(
    offerId: bigint,
    loanId: bigint,
    borrower: string,
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
    network: ethers.Network,
    contractAddress: string,
    contract: VouchVault,
  ) {
    try {
      const runner = contract.runner;
      const provider: ethers.Provider | null =
        runner &&
        typeof (runner as Partial<ethers.Provider>).getBlock === 'function'
          ? (runner as ethers.Provider)
          : (runner?.provider ?? null);

      const [loan, receipt] = await Promise.all([
        contract.loans(loanId),
        provider
          ? provider.getTransactionReceipt(transactionHash)
          : Promise.resolve(null),
      ]);

      // Locate the actual Transfer log indices from the receipt. The collateral
      // deposit transfer (borrower → vault) precedes the disbursement transfer
      // (vault → borrower) in the same tx. Fall back to the LendOfferAccepted
      // event's logIndex if the receipt is unavailable.
      const transferTopic = ethers.id('Transfer(address,address,uint256)');
      const transferLogs =
        receipt?.logs.filter((l) => l.topics[0] === transferTopic) ?? [];
      const collateralLogIndex =
        transferLogs.find(
          (l) =>
            l.topics[2] ===
            ethers.zeroPadValue(contractAddress.toLowerCase(), 32),
        )?.index ?? logIndex;
      const disbursementLogIndex =
        transferLogs.find(
          (l) =>
            l.topics[1] ===
            ethers.zeroPadValue(contractAddress.toLowerCase(), 32),
        )?.index ?? (receipt?.logs?.at(-1)?.index ?? logIndex) + 1;

      await this.loanService.acceptLendOffer({
        offerId,
        loanId,
        borrowerAddress: borrower,
        collateralTokenAddress: loan.collateralToken,
        collateralAmount: loan.collateralAmount,
        networkId: network.chainId.toString(),
        contractAddress,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        collateralLogIndex,
        disbursementLogIndex,
        acceptedAt: new Date(Number(loan.fundedAt) * 1000),
      });
      this.logger.log(
        `LendOffer ${offerId.toString()} accepted by ${borrower} → loan ${loanId.toString()}`,
      );
    } catch (error) {
      this.logger.error('Failed to accept lend offer in DB', error);
    }
  }

  protected async handleLendOfferCancelled(
    offerId: bigint,
    lender: string,
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
    network: ethers.Network,
    contractAddress: string,
  ) {
    try {
      await this.loanService.cancelLendOffer({
        offerId,
        lenderAddress: lender,
        networkId: network.chainId.toString(),
        contractAddress,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        cancelledAt: new Date(),
      });
      this.logger.log(`LendOffer ${offerId.toString()} cancelled by ${lender}`);
    } catch (error) {
      this.logger.error('Failed to cancel lend offer in DB', error);
    }
  }

  protected async handleLendOfferExpired(
    offerId: bigint,
    { transactionHash, blockNumber, blockHash, index: logIndex }: ethers.Log,
    network: ethers.Network,
    contractAddress: string,
  ) {
    try {
      await this.loanService.expireLendOffer({
        offerId,
        networkId: network.chainId.toString(),
        contractAddress,
        txHash: transactionHash,
        blockNumber,
        blockHash,
        logIndex,
        expiredAt: new Date(),
      });
      this.logger.log(`LendOffer ${offerId.toString()} expired`);
    } catch (error) {
      this.logger.error('Failed to expire lend offer in DB', error);
    }
  }

  /**
   * Read the cumulative, monotonic repayment-progress fields from the on-chain
   * loan struct (the public `loans` getter). These are not carried by the
   * repayment events, so caching them in the DB requires a live read. On failure
   * we fall back to 0 — the SQL caches with GREATEST(...) so a 0 can never
   * regress an already-cached value. For a terminal LoanRepaid (which has no
   * later event to reconcile), `repay_loan_with_transaction` additionally clamps
   * these up to the loan's full principal/collateral, so a failed read here can
   * never leave a repaid loan stuck at 0.
   */
  private async readRepaidAmounts(
    contract: VouchVault,
    loanId: bigint,
  ): Promise<{ principalRepaid: bigint; collateralReleased: bigint }> {
    try {
      const loan = await contract.loans(loanId);
      return {
        principalRepaid: loan.principalRepaid,
        collateralReleased: loan.collateralReleased,
      };
    } catch (error) {
      this.logger.error(
        `Failed to read repaid amounts for loan ${loanId.toString()} from chain`,
        error,
      );
      return { principalRepaid: 0n, collateralReleased: 0n };
    }
  }
}
