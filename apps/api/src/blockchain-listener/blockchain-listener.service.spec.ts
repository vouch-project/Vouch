import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { LoansService } from '../loans/loans.service';
import { SupabaseService } from '../supabase/supabase.service';
import { BlockchainListenerService } from './blockchain-listener.service';

// enqueue() and the handlers are private; tests reach them via bracket access.
type ServiceInternals = {
  enqueue(key: string, task: () => Promise<void>): void;
  eventQueues: Map<string, Promise<void>>;
  handleLoanPartiallyRepaid(
    loanId: bigint,
    borrower: string,
    paymentAmount: bigint,
    timestamp: bigint,
    log: Pick<
      ethers.EventLog,
      'transactionHash' | 'blockNumber' | 'blockHash' | 'index'
    >,
    network: ethers.Network,
    contractAddress: string,
  ): Promise<void>;
};

const flush = (service: BlockchainListenerService, key: string) =>
  (service as unknown as ServiceInternals).eventQueues.get(key) ??
  Promise.resolve();

describe('BlockchainListenerService', () => {
  let service: BlockchainListenerService;
  let internals: ServiceInternals;
  let partialRepay: jest.Mock;

  const key = '1:0xcontract';

  beforeEach(async () => {
    partialRepay = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainListenerService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SupabaseService, useValue: { client: {} } },
        { provide: LoansService, useValue: { partialRepay } },
      ],
    }).compile();

    service = module.get(BlockchainListenerService);
    internals = service as unknown as ServiceInternals;

    // Silence the logger so expected error-path logs don't clutter test output.
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  });

  describe('enqueue', () => {
    it('runs tasks for a chain serially in FIFO order', async () => {
      const order: number[] = [];
      const task = (n: number, delayMs: number) => () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            order.push(n);
            resolve();
          }, delayMs),
        );

      // First task is slowest; serial execution must still finish it first.
      internals.enqueue(key, task(1, 30));
      internals.enqueue(key, task(2, 10));
      internals.enqueue(key, task(3, 0));

      await flush(service, key);

      expect(order).toEqual([1, 2, 3]);
    });

    it('keeps processing later tasks after an earlier task rejects', async () => {
      const second = jest.fn().mockResolvedValue(undefined);

      internals.enqueue(key, () => Promise.reject(new Error('boom')));
      internals.enqueue(key, second);

      await flush(service, key);

      expect(second).toHaveBeenCalledTimes(1);
    });

    it('isolates queues by key so one chain does not block another', async () => {
      const order: string[] = [];
      internals.enqueue('chainA', () => Promise.reject(new Error('a fails')));
      internals.enqueue('chainB', async () => {
        order.push('b ran');
      });

      await Promise.all([flush(service, 'chainA'), flush(service, 'chainB')]);

      expect(order).toEqual(['b ran']);
    });
  });

  describe('handleLoanPartiallyRepaid', () => {
    const log = {
      transactionHash: '0xtx',
      blockNumber: 100,
      blockHash: '0xblock',
      index: 0,
    };
    const network = { chainId: 1n } as ethers.Network;

    it('forwards event data to loanService.partialRepay', async () => {
      await internals.handleLoanPartiallyRepaid(
        7n,
        '0xborrower',
        500n,
        1700000000n,
        log,
        network,
        '0xcontract',
      );

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

      await expect(
        internals.handleLoanPartiallyRepaid(
          7n,
          '0xborrower',
          500n,
          1700000000n,
          log,
          network,
          '0xcontract',
        ),
      ).resolves.toBeUndefined();
    });

    it('does not let a failed handler block the next queued event', async () => {
      partialRepay
        .mockRejectedValueOnce(new Error('transient supabase error'))
        .mockResolvedValueOnce(undefined);

      const call = () =>
        internals.handleLoanPartiallyRepaid(
          7n,
          '0xborrower',
          500n,
          1700000000n,
          log,
          network,
          '0xcontract',
        );

      internals.enqueue(key, call);
      internals.enqueue(key, call);

      await flush(service, key);

      expect(partialRepay).toHaveBeenCalledTimes(2);
    });
  });
});
