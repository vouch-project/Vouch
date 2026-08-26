import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { VouchVault } from '@vouch/contracts';
import { ethers } from 'ethers';
import { LoansService } from '../loans/loans.service';
import { SupabaseService } from '../supabase/supabase.service';
import { BlockchainListenerService } from './blockchain-listener.service';

// Exposes the protected handler through a test-only subclass so we can verify
// it via a real method call rather than reaching into private members.
class TestableListener extends BlockchainListenerService {
  callHandleLoanPartiallyRepaid(
    ...args: Parameters<BlockchainListenerService['handleLoanPartiallyRepaid']>
  ) {
    return this.handleLoanPartiallyRepaid(...args);
  }

  callHandleLoanCreated(
    ...args: Parameters<BlockchainListenerService['handleLoanCreated']>
  ): ReturnType<BlockchainListenerService['handleLoanCreated']> {
    return this.handleLoanCreated(...args);
  }

  callHandleLoanCancelled(
    ...args: Parameters<BlockchainListenerService['handleLoanCancelled']>
  ) {
    return this.handleLoanCancelled(...args);
  }

  callHandleLoanExpired(
    ...args: Parameters<BlockchainListenerService['handleLoanExpired']>
  ) {
    return this.handleLoanExpired(...args);
  }

  callHandleSignedLoanRequestFilled(
    ...args: Parameters<
      BlockchainListenerService['handleSignedLoanRequestFilled']
    >
  ) {
    return this.handleSignedLoanRequestFilled(...args);
  }

  callHandleSignedLendOfferFilled(
    ...args: Parameters<
      BlockchainListenerService['handleSignedLendOfferFilled']
    >
  ) {
    return this.handleSignedLendOfferFilled(...args);
  }

  callHandleSignedLoanRequestCancelled(
    ...args: Parameters<
      BlockchainListenerService['handleSignedLoanRequestCancelled']
    >
  ) {
    return this.handleSignedLoanRequestCancelled(...args);
  }

  callHandleSignedLendOfferCancelled(
    ...args: Parameters<
      BlockchainListenerService['handleSignedLendOfferCancelled']
    >
  ) {
    return this.handleSignedLendOfferCancelled(...args);
  }
}

describe('BlockchainListenerService', () => {
  let service: TestableListener;
  let loanService: LoansService;
  let partialRepay: jest.Mock;
  let create: jest.Mock;
  let cancel: jest.Mock;
  let expire: jest.Mock;
  let fillSignedOrder: jest.Mock;
  let cancelSignedOrder: jest.Mock;

  const log = {
    transactionHash: '0xtx',
    blockNumber: 100,
    blockHash: '0xblock',
    index: 0,
  } as ethers.Log;
  const network = { chainId: 1n } as ethers.Network;

  const repayContract = {
    loans: jest.fn().mockResolvedValue({
      principalRepaid: 300n,
      collateralReleased: 600n,
    }),
  } as unknown as VouchVault;

  const invoke = () =>
    service.callHandleLoanPartiallyRepaid(
      7n,
      '0xborrower',
      500n,
      1700000000n,
      log,
      network,
      '0xcontract',
      repayContract,
    );

  beforeEach(async () => {
    partialRepay = jest.fn().mockResolvedValue(undefined);
    create = jest.fn().mockResolvedValue(undefined);
    cancel = jest.fn().mockResolvedValue(undefined);
    expire = jest.fn().mockResolvedValue(undefined);
    fillSignedOrder = jest.fn().mockResolvedValue(undefined);
    cancelSignedOrder = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestableListener,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SupabaseService, useValue: { client: {} } },
        {
          provide: LoansService,
          useValue: {
            partialRepay,
            create,
            cancel,
            expire,
            fillSignedOrder,
            cancelSignedOrder,
          },
        },
      ],
    }).compile();

    service = module.get(TestableListener);
    loanService = module.get(LoansService);

    // Silence expected error-path logs so they don't clutter test output.
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  });

  describe('onModuleInit', () => {
    it('calls destroy() on a WebSocketProvider whose getNetwork() rejects so its reconnection loop cannot leak', async () => {
      const destroy = jest.fn();
      const badProvider = {
        getNetwork: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        destroy,
      };

      const wsSpy = jest
        .spyOn(
          ethers as unknown as Record<string, unknown>,
          'WebSocketProvider',
        )
        .mockImplementation(() => badProvider);

      // Override the injected supabase client so onModuleInit sees one WS chain
      (service as unknown as Record<string, unknown>)['supabaseService'] = {
        client: {
          from: jest.fn().mockReturnValue({
            select: jest.fn().mockResolvedValue({
              data: [
                {
                  wsRpcUrl: 'ws://localhost:8545',
                  rpcUrl: null,
                  contractAddress: '0xcontract',
                },
              ],
              error: null,
            }),
          }),
        },
      };

      await service.onModuleInit();

      expect(destroy).toHaveBeenCalled();
      wsSpy.mockRestore();
    });
  });

  describe('handleLoanPartiallyRepaid', () => {
    it('forwards event data to loanService.partialRepay', async () => {
      await invoke();

      expect(partialRepay).toHaveBeenCalledWith(
        expect.objectContaining({
          onChainLoanId: 7n,
          borrowerAddress: '0xborrower',
          paymentAmount: 500n,
          principalRepaid: 300n,
          collateralReleased: 600n,
          txHash: '0xtx',
          logIndex: 0,
        }),
      );
    });

    it('swallows RPC failures (e.g. missing-lender) without throwing', async () => {
      partialRepay.mockRejectedValueOnce(
        new Error('Loan 7 has no lender set (loan not funded yet?)'),
      );

      await expect(invoke()).resolves.toBeUndefined();
    });
  });

  describe('handleLoanCreated', () => {
    it('reads loan terms from the contract and forwards them to loanService.create', async () => {
      const createdAt = 1700000000n;
      const fundDeadline = createdAt + 604800n; // +7 days
      const contract = {
        loans: jest.fn().mockResolvedValue({
          interestRateBps: 500n,
          durationSeconds: 2592000n,
          fundDeadline,
        }),
      } as unknown as VouchVault;

      await service.callHandleLoanCreated(
        1n, // loanId
        '0xborrower', // borrower
        '0xcollateralToken', // collateralTokenAddress
        1000n, // collateralAmount
        '0xprincipalToken', // requestedPrincipalToken
        500n, // requestedPrincipalAmount
        createdAt, // timestamp
        log, // eventLog
        network, // network
        '0xcontract', // contractAddress
        contract, // NEW final arg
      );

      expect(contract.loans).toHaveBeenCalledWith(1n);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          loanId: 1n,
          interestRateBps: 500,
          durationSeconds: 2592000,
          fundWindowSeconds: 604800,
        }),
      );
    });
  });

  describe('handleLoanCancelled', () => {
    it('forwards event data to loanService.cancel', async () => {
      await service.callHandleLoanCancelled(
        5n,
        '0xborrower',
        1700000000n,
        log,
        network,
        '0xcontract',
      );
      expect(cancel).toHaveBeenCalledWith(
        expect.objectContaining({
          onChainLoanId: 5n,
          borrowerAddress: '0xborrower',
          txHash: '0xtx',
          logIndex: 0,
          cancelledAt: new Date(Number(1700000000n) * 1000),
        }),
      );
    });
  });

  describe('handleLoanExpired', () => {
    it('calls loanService.expire with correct parameters', async () => {
      const loanId = 1n;
      const borrower = '0xBorrower';
      const timestamp = 1700000000n;
      const mockLog = {
        transactionHash: '0xabc',
        blockNumber: 100,
        blockHash: '0xblockhash',
        index: 0,
      } as ethers.Log;
      const mockNetwork = { chainId: 1337n } as ethers.Network;
      const contractAddress = '0xContract';

      const expireSpy = jest
        .spyOn(loanService, 'expire')
        .mockResolvedValue(undefined);

      await service.callHandleLoanExpired(
        loanId,
        borrower,
        timestamp,
        mockLog,
        mockNetwork,
        contractAddress,
      );

      expect(expireSpy).toHaveBeenCalledWith({
        onChainLoanId: loanId,
        networkId: '1337',
        contractAddress,
        borrowerAddress: borrower,
        txHash: '0xabc',
        blockNumber: 100,
        blockHash: '0xblockhash',
        logIndex: 0,
        expiredAt: new Date(Number(timestamp) * 1000),
      });
    });
  });

  // ── Signed-order handlers ────────────────────────────────────────────────

  describe('handleSignedLoanRequestFilled', () => {
    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    const contractAddress = '0x1234567890123456789012345678901234567890';
    // Pad the contract address to a 32-byte topic (as ethers does in logs)
    const contractPadded = ethers.zeroPadValue(
      contractAddress.toLowerCase(),
      32,
    );

    const collateralTransferLog = {
      topics: [transferTopic, '0xsender', contractPadded],
      index: 5,
    } as unknown as ethers.Log;
    const disbursementTransferLog = {
      topics: [transferTopic, contractPadded, '0xrecipient'],
      index: 7,
    } as unknown as ethers.Log;

    const receipt = {
      logs: [collateralTransferLog, disbursementTransferLog],
    } as unknown as ethers.TransactionReceipt;

    const provider = {
      getTransactionReceipt: jest.fn().mockResolvedValue(receipt),
      getBlock: jest.fn().mockResolvedValue(null),
    };
    const contract = {
      runner: provider,
    } as unknown as VouchVault;

    const filledLog = {
      transactionHash: '0xtxfill',
      blockNumber: 200,
      blockHash: '0xblockhash2',
      index: 3,
    } as ethers.Log;
    const fillNetwork = { chainId: 1n } as ethers.Network;

    it('calls loanService.fillSignedOrder with orderKind request and correct filler/log indices', async () => {
      await service.callHandleSignedLoanRequestFilled(
        1n, // loanId
        '0xdigest', // digest
        '0xaaBBccDDeeFF0011223344556677889900aAbBcC', // borrower (signed the request)
        '0xaaBBccDDeeFF0011223344556677889900aAbBcD', // lender (the filler)
        '0xaaBBccDDeeFF0011223344556677889900aAbBcE', // collateralToken
        1000n, // collateralAmount
        '0xaaBBccDDeeFF0011223344556677889900aAbBcF', // principalToken
        500n, // principalAmount
        1700000000n, // timestamp
        filledLog,
        fillNetwork,
        contractAddress,
        contract,
      );

      expect(fillSignedOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          orderKind: 'request',
          digest: '0xdigest',
          loanId: 1n,
          fillerAddress: '0xaaBBccDDeeFF0011223344556677889900aAbBcD',
          collateralTokenAddress: '0xaaBBccDDeeFF0011223344556677889900aAbBcE',
          collateralAmount: 1000n,
          networkId: '1',
          contractAddress,
          txHash: '0xtxfill',
          blockNumber: BigInt(200),
          blockHash: '0xblockhash2',
          collateralLogIndex: BigInt(5),
          disbursementLogIndex: BigInt(7),
          filledAt: new Date(1700000000 * 1000),
        }),
      );
    });

    it('falls back to event logIndex when no receipt is available', async () => {
      const noReceiptProvider = {
        getTransactionReceipt: jest.fn().mockResolvedValue(null),
        getBlock: jest.fn().mockResolvedValue(null),
      };
      const noReceiptContract = {
        runner: noReceiptProvider,
      } as unknown as VouchVault;

      await service.callHandleSignedLoanRequestFilled(
        2n,
        '0xdigest2',
        '0xaaBBccDDeeFF0011223344556677889900aAbBcC',
        '0xaaBBccDDeeFF0011223344556677889900aAbBcD',
        '0xaaBBccDDeeFF0011223344556677889900aAbBcE',
        500n,
        '0xaaBBccDDeeFF0011223344556677889900aAbBcF',
        250n,
        1700000001n,
        filledLog,
        fillNetwork,
        contractAddress,
        noReceiptContract,
      );

      expect(fillSignedOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          collateralLogIndex: BigInt(3),
        }),
      );
    });
  });

  describe('handleSignedLendOfferFilled', () => {
    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    const contractAddress = '0x1234567890123456789012345678901234567890';
    const contractPadded = ethers.zeroPadValue(
      contractAddress.toLowerCase(),
      32,
    );

    const collateralTransferLog = {
      topics: [transferTopic, '0xsender', contractPadded],
      index: 9,
    } as unknown as ethers.Log;
    const disbursementTransferLog = {
      topics: [transferTopic, contractPadded, '0xrecipient'],
      index: 11,
    } as unknown as ethers.Log;

    const receipt = {
      logs: [collateralTransferLog, disbursementTransferLog],
    } as unknown as ethers.TransactionReceipt;

    const provider = {
      getTransactionReceipt: jest.fn().mockResolvedValue(receipt),
      getBlock: jest.fn().mockResolvedValue(null),
    };
    const contract = {
      runner: provider,
    } as unknown as VouchVault;

    const filledLog = {
      transactionHash: '0xtxoffer',
      blockNumber: 300,
      blockHash: '0xblockhash3',
      index: 4,
    } as ethers.Log;
    const fillNetwork = { chainId: 1n } as ethers.Network;

    it('calls loanService.fillSignedOrder with orderKind offer and fillerAddress=borrower', async () => {
      await service.callHandleSignedLendOfferFilled(
        10n, // loanId
        '0xdigest3', // digest
        '0xaaBBccDDeeFF0011223344556677889900aAbBcD', // lender (signed the offer)
        '0xaaBBccDDeeFF0011223344556677889900aAbBcC', // borrower (the filler)
        '0xaaBBccDDeeFF0011223344556677889900aAbBcF', // principalToken
        800n, // principalAmount
        '0xaaBBccDDeeFF0011223344556677889900aAbBcE', // collateralToken
        2000n, // collateralAmount
        1700000002n, // timestamp
        filledLog,
        fillNetwork,
        contractAddress,
        contract,
      );

      expect(fillSignedOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          orderKind: 'offer',
          digest: '0xdigest3',
          loanId: 10n,
          fillerAddress: '0xaaBBccDDeeFF0011223344556677889900aAbBcC',
          collateralTokenAddress: '0xaaBBccDDeeFF0011223344556677889900aAbBcE',
          collateralAmount: 2000n,
          networkId: '1',
          contractAddress,
          txHash: '0xtxoffer',
          blockNumber: BigInt(300),
          blockHash: '0xblockhash3',
          collateralLogIndex: BigInt(9),
          disbursementLogIndex: BigInt(11),
          filledAt: new Date(1700000002 * 1000),
        }),
      );
    });
  });

  describe('handleSignedLoanRequestCancelled', () => {
    it('calls loanService.cancelSignedOrder with correct params', async () => {
      await service.callHandleSignedLoanRequestCancelled(
        '0xdigestcancel',
        '0xborrower',
        log,
        network,
        '0xcontract',
      );

      expect(cancelSignedOrder).toHaveBeenCalledWith({
        digest: '0xdigestcancel',
        networkId: '1',
        contractAddress: '0xcontract',
      });
    });
  });

  describe('handleSignedLendOfferCancelled', () => {
    it('calls loanService.cancelSignedOrder with correct params', async () => {
      await service.callHandleSignedLendOfferCancelled(
        '0xdigestcancel2',
        '0xlender',
        log,
        network,
        '0xcontract',
      );

      expect(cancelSignedOrder).toHaveBeenCalledWith({
        digest: '0xdigestcancel2',
        networkId: '1',
        contractAddress: '0xcontract',
      });
    });
  });
});
