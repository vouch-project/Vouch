import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from '../supabase/supabase.service';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { FillSignedOrderDto } from './dto/fill-signed-order.dto';
import { CancelSignedOrderDto } from './dto/cancel-signed-order.dto';

describe('LoansService', () => {
  let service: LoansService;
  let rpc: jest.Mock;

  beforeEach(async () => {
    rpc = jest.fn().mockResolvedValue({ error: null });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: SupabaseService, useValue: { client: { rpc } } },
      ],
    }).compile();

    service = module.get<LoansService>(LoansService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('forwards interest rate, duration, and fund deadline to the create RPC', async () => {
    const collateralLockedAt = new Date('2026-01-01T00:00:00.000Z');
    const dto: CreateLoanDto = {
      loanId: 1n,
      borrower: '0x' + '1'.repeat(40),
      collateralAmount: 1000n,
      requestedPrincipalTokenAddress: '0x' + '2'.repeat(40),
      requestedPrincipalAmount: 500n,
      networkId: '31337',
      collateralTxHash: '0xhash',
      collateralBlockNumber: 10,
      collateralBlockHash: '0xblock',
      collateralLockedAt,
      collateralTokenAddress: '0x' + '3'.repeat(40),
      logIndex: 0,
      contractAddress: '0x' + '4'.repeat(40),
      interestRateBps: 500,
      durationSeconds: 2592000,
      fundWindowSeconds: 604800,
    };

    await service.create(dto);

    expect(rpc).toHaveBeenCalledWith(
      'create_loan_with_transaction',
      expect.objectContaining({
        p_interest_rate_bps: 500,
        p_duration_seconds: 2592000,
        p_fund_deadline: new Date(
          collateralLockedAt.getTime() + 604800 * 1000,
        ).toISOString(),
      }),
    );
  });

  it('forwards cancellation data to the cancel RPC', async () => {
    const cancelledAt = new Date('2026-02-01T00:00:00.000Z');
    await service.cancel({
      onChainLoanId: 3n,
      networkId: '31337',
      contractAddress: '0x' + '4'.repeat(40),
      borrowerAddress: '0x' + '1'.repeat(40),
      txHash: '0xhash',
      blockNumber: 12,
      blockHash: '0xblock',
      logIndex: 0,
      cancelledAt,
    });

    expect(rpc).toHaveBeenCalledWith('cancel_loan_with_transaction', {
      p_network_id: '31337',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      p_contract_address: expect.any(String),
      p_on_chain_loan_id: '3',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      p_borrower_address: expect.any(String),
      p_tx_hash: '0xhash',
      p_block_number: '12',
      p_block_hash: '0xblock',
      p_log_index: '0',
      p_cancelled_at: cancelledAt.toISOString(),
    });
  });

  it('fillSignedOrder calls fill_signed_order_with_transaction with mapped params', async () => {
    const filledAt = new Date('2026-08-21T00:00:00Z');
    const dto: FillSignedOrderDto = {
      orderKind: 'request',
      digest: '0xabc',
      loanId: 5n,
      fillerAddress: '0x00000000000000000000000000000000000000A0',
      collateralTokenAddress: '0x0000000000000000000000000000000000000002',
      collateralAmount: 1000n,
      networkId: '31337',
      contractAddress: '0x1111111111111111111111111111111111111111',
      txHash: '0xtx',
      blockNumber: 1n,
      blockHash: '0xbh',
      collateralLogIndex: 0n,
      disbursementLogIndex: 1n,
      filledAt,
    };

    await service.fillSignedOrder(dto);

    expect(rpc).toHaveBeenCalledWith(
      'fill_signed_order_with_transaction',
      expect.objectContaining({
        p_order_kind: 'request',
        p_digest: '0xabc',
        p_on_chain_loan_id: '5',
        p_filler_address: expect.any(String),
        p_collateral_token_address: expect.any(String),
        p_collateral_amount: '1000',
        p_network_id: '31337',
        p_contract_address: expect.any(String),
        p_tx_hash: '0xtx',
        p_block_number: '1',
        p_block_hash: '0xbh',
        p_collateral_log_index: '0',
        p_disbursement_log_index: '1',
        p_filled_at: filledAt.toISOString(),
      }),
    );
  });

  it('cancelSignedOrder calls cancel_signed_order with mapped params', async () => {
    const dto: CancelSignedOrderDto = {
      digest: '0xdeadbeef',
      networkId: '31337',
      contractAddress: '0x1111111111111111111111111111111111111111',
    };

    await service.cancelSignedOrder(dto);

    expect(rpc).toHaveBeenCalledWith(
      'cancel_signed_order',
      expect.objectContaining({
        p_digest: '0xdeadbeef',
        p_network_id: '31337',
        p_contract_address: expect.any(String),
      }),
    );
  });
});
