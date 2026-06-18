import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
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
  ) {
    return this.handleLoanCreated(...args);
  }
}

describe('BlockchainListenerService', () => {
  let service: TestableListener;
  let partialRepay: jest.Mock;
  let create: jest.Mock;

  const log = {
    transactionHash: '0xtx',
    blockNumber: 100,
    blockHash: '0xblock',
    index: 0,
  } as ethers.EventLog;
  const network = { chainId: 1n } as ethers.Network;

  const invoke = () =>
    service.callHandleLoanPartiallyRepaid(
      7n,
      '0xborrower',
      500n,
      1700000000n,
      log,
      network,
      '0xcontract',
    );

  beforeEach(async () => {
    partialRepay = jest.fn().mockResolvedValue(undefined);
    create = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestableListener,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SupabaseService, useValue: { client: {} } },
        { provide: LoansService, useValue: { partialRepay, create } },
      ],
    }).compile();

    service = module.get(TestableListener);

    // Silence expected error-path logs so they don't clutter test output.
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  });

  describe('handleLoanPartiallyRepaid', () => {
    it('forwards event data to loanService.partialRepay', async () => {
      await invoke();

      expect(partialRepay).toHaveBeenCalledWith(
        expect.objectContaining({
          onChainLoanId: 7n,
          borrowerAddress: '0xborrower',
          paymentAmount: 500n,
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
        getRepaymentDetails: jest
          .fn()
          .mockResolvedValue([500n, 2592000n, false, 0n, 0n, 0n, fundDeadline]),
      } as unknown as ethers.Contract;

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

      expect(contract.getRepaymentDetails).toHaveBeenCalledWith(1n);
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
});
