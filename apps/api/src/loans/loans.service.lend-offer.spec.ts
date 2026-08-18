import { Test } from '@nestjs/testing';
import { LoansService } from './loans.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('LoansService lend offer methods', () => {
  let service: LoansService;
  let rpcMock: jest.Mock;

  beforeEach(async () => {
    rpcMock = jest.fn().mockResolvedValue({ error: null });
    const module = await Test.createTestingModule({
      providers: [
        LoansService,
        {
          provide: SupabaseService,
          useValue: { client: { rpc: rpcMock } },
        },
      ],
    }).compile();
    service = module.get(LoansService);
  });

  it('createLendOffer calls create_lend_offer_with_transaction', async () => {
    await service.createLendOffer({
      offerId: 0n,
      lenderAddress: '0x' + '1'.repeat(40),
      principalTokenAddress: '0x' + '2'.repeat(40),
      principalAmount: 1000000000000000000n,
      collateralTokenAddress: '0x' + '3'.repeat(40),
      minCollateralAmount: 1500000000000000000n,
      maxLtvBps: 6500,
      interestRateBps: 800,
      durationSeconds: 2592000,
      acceptWindowSeconds: 604800,
      networkId: '11155111',
      contractAddress: '0x' + '4'.repeat(40),
      txHash: '0xabc',
      blockNumber: 100,
      blockHash: '0xblock',
      logIndex: 0,
      createdAt: new Date('2026-08-18T00:00:00Z'),
    });
    expect(rpcMock).toHaveBeenCalledWith(
      'create_lend_offer_with_transaction',
      expect.objectContaining({ p_on_chain_offer_id: '0' }),
    );
  });

  it('cancelLendOffer calls cancel_lend_offer_with_transaction', async () => {
    await service.cancelLendOffer({
      offerId: 0n,
      lenderAddress: '0x' + '1'.repeat(40),
      networkId: '11155111',
      contractAddress: '0x' + '4'.repeat(40),
      txHash: '0xabc',
      blockNumber: 101,
      blockHash: '0xblock',
      logIndex: 0,
      cancelledAt: new Date('2026-08-18T01:00:00Z'),
    });
    expect(rpcMock).toHaveBeenCalledWith(
      'cancel_lend_offer_with_transaction',
      expect.objectContaining({ p_on_chain_offer_id: '0' }),
    );
  });
});
