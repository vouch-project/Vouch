import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from '../supabase/supabase.service';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';

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
});
