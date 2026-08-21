import { Test } from '@nestjs/testing';
import { ethers } from 'ethers';
import { SignedOrdersService } from './signed-orders.service';
import { SupabaseService } from '../supabase/supabase.service';
import { buildDomain, LOAN_REQUEST_TYPES, LEND_OFFER_TYPES } from './eip712';

describe('SignedOrdersService', () => {
  const rpc = jest.fn().mockResolvedValue({ error: null });
  const supabase = { client: { rpc } } as unknown as SupabaseService;
  let service: SignedOrdersService;

  beforeEach(async () => {
    rpc.mockClear();
    const mod = await Test.createTestingModule({
      providers: [SignedOrdersService, { provide: SupabaseService, useValue: supabase }],
    }).compile();
    service = mod.get(SignedOrdersService);
  });

  it('rejects a request whose signature does not match borrower', async () => {
    const other = ethers.Wallet.createRandom();
    const dto: any = {
      borrowerAddress: '0x000000000000000000000000000000000000dEaD',
      collateralTokenAddress: '0x0000000000000000000000000000000000000002',
      collateralAmount: 1000n,
      principalTokenAddress: ethers.ZeroAddress,
      principalAmount: 500n,
      interestRateBps: 800,
      durationSeconds: 2592000,
      maxLtvBps: 6500,
      nonce: 1n,
      deadline: 9999999999,
      networkId: '31337',
      contractAddress: '0x1111111111111111111111111111111111111111',
    };
    const domain = buildDomain(31337n, dto.contractAddress);
    dto.signature = await other.signTypedData(domain, LOAN_REQUEST_TYPES, {
      borrower: dto.borrowerAddress,
      collateralToken: dto.collateralTokenAddress,
      collateralAmount: dto.collateralAmount.toString(),
      principalToken: dto.principalTokenAddress,
      principalAmount: dto.principalAmount.toString(),
      interestRateBps: dto.interestRateBps,
      durationSeconds: dto.durationSeconds.toString(),
      maxLtvBps: dto.maxLtvBps,
      nonce: dto.nonce.toString(),
      deadline: dto.deadline.toString(),
    });
    await expect(service.createLoanRequest(dto)).rejects.toThrow(/signature/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stores a valid request via RPC', async () => {
    const wallet = ethers.Wallet.createRandom();
    const dto: any = {
      borrowerAddress: wallet.address,
      collateralTokenAddress: '0x0000000000000000000000000000000000000002',
      collateralAmount: 1000n,
      principalTokenAddress: ethers.ZeroAddress,
      principalAmount: 500n,
      interestRateBps: 800,
      durationSeconds: 2592000,
      maxLtvBps: 6500,
      nonce: 1n,
      deadline: 9999999999,
      networkId: '31337',
      contractAddress: '0x1111111111111111111111111111111111111111',
    };
    const domain = buildDomain(31337n, dto.contractAddress);
    dto.signature = await wallet.signTypedData(domain, LOAN_REQUEST_TYPES, {
      borrower: dto.borrowerAddress,
      collateralToken: dto.collateralTokenAddress,
      collateralAmount: dto.collateralAmount.toString(),
      principalToken: dto.principalTokenAddress,
      principalAmount: dto.principalAmount.toString(),
      interestRateBps: dto.interestRateBps,
      durationSeconds: dto.durationSeconds.toString(),
      maxLtvBps: dto.maxLtvBps,
      nonce: dto.nonce.toString(),
      deadline: dto.deadline.toString(),
    });
    const res = await service.createLoanRequest(dto);
    expect(res.digest).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(rpc).toHaveBeenCalledWith(
      'insert_signed_loan_request',
      expect.objectContaining({ p_digest: res.digest }),
    );
  });

  it('rejects a loan request with an expired deadline', async () => {
    const wallet = ethers.Wallet.createRandom();
    const dto: any = {
      borrowerAddress: wallet.address,
      collateralTokenAddress: '0x0000000000000000000000000000000000000002',
      collateralAmount: 1000n,
      principalTokenAddress: ethers.ZeroAddress,
      principalAmount: 500n,
      interestRateBps: 800,
      durationSeconds: 2592000,
      maxLtvBps: 6500,
      nonce: 1n,
      deadline: 1, // expired — unix second 1 is far in the past
      networkId: '31337',
      contractAddress: '0x1111111111111111111111111111111111111111',
    };
    const domain = buildDomain(31337n, dto.contractAddress);
    dto.signature = await wallet.signTypedData(domain, LOAN_REQUEST_TYPES, {
      borrower: dto.borrowerAddress,
      collateralToken: dto.collateralTokenAddress,
      collateralAmount: dto.collateralAmount.toString(),
      principalToken: dto.principalTokenAddress,
      principalAmount: dto.principalAmount.toString(),
      interestRateBps: dto.interestRateBps,
      durationSeconds: dto.durationSeconds.toString(),
      maxLtvBps: dto.maxLtvBps,
      nonce: dto.nonce.toString(),
      deadline: dto.deadline.toString(),
    });
    await expect(service.createLoanRequest(dto)).rejects.toThrow(/expired/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a lend offer whose signature does not match lender', async () => {
    const other = ethers.Wallet.createRandom();
    const dto: any = {
      lenderAddress: '0x000000000000000000000000000000000000dEaD',
      principalTokenAddress: ethers.ZeroAddress,
      principalAmount: 500n,
      collateralTokenAddress: '0x0000000000000000000000000000000000000002',
      collateralRatioBps: 15000,
      trustedRatioBps: 12000,
      scoreThreshold: 700,
      maxLtvBps: 6500,
      interestRateBps: 800,
      durationSeconds: 2592000,
      nonce: 1n,
      deadline: 9999999999,
      networkId: '31337',
      contractAddress: '0x1111111111111111111111111111111111111111',
    };
    const domain = buildDomain(31337n, dto.contractAddress);
    dto.signature = await other.signTypedData(domain, LEND_OFFER_TYPES, {
      lender: dto.lenderAddress,
      principalToken: dto.principalTokenAddress,
      principalAmount: dto.principalAmount.toString(),
      collateralToken: dto.collateralTokenAddress,
      collateralRatioBps: dto.collateralRatioBps,
      trustedRatioBps: dto.trustedRatioBps,
      scoreThreshold: dto.scoreThreshold,
      maxLtvBps: dto.maxLtvBps,
      interestRateBps: dto.interestRateBps,
      durationSeconds: dto.durationSeconds.toString(),
      nonce: dto.nonce.toString(),
      deadline: dto.deadline.toString(),
    });
    await expect(service.createLendOffer(dto)).rejects.toThrow(/signature/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stores a valid lend offer via RPC', async () => {
    const wallet = ethers.Wallet.createRandom();
    const dto: any = {
      lenderAddress: wallet.address,
      principalTokenAddress: ethers.ZeroAddress,
      principalAmount: 500n,
      collateralTokenAddress: '0x0000000000000000000000000000000000000002',
      collateralRatioBps: 15000,
      trustedRatioBps: 12000,
      scoreThreshold: 700,
      maxLtvBps: 6500,
      interestRateBps: 800,
      durationSeconds: 2592000,
      nonce: 1n,
      deadline: 9999999999,
      networkId: '31337',
      contractAddress: '0x1111111111111111111111111111111111111111',
    };
    const domain = buildDomain(31337n, dto.contractAddress);
    dto.signature = await wallet.signTypedData(domain, LEND_OFFER_TYPES, {
      lender: dto.lenderAddress,
      principalToken: dto.principalTokenAddress,
      principalAmount: dto.principalAmount.toString(),
      collateralToken: dto.collateralTokenAddress,
      collateralRatioBps: dto.collateralRatioBps,
      trustedRatioBps: dto.trustedRatioBps,
      scoreThreshold: dto.scoreThreshold,
      maxLtvBps: dto.maxLtvBps,
      interestRateBps: dto.interestRateBps,
      durationSeconds: dto.durationSeconds.toString(),
      nonce: dto.nonce.toString(),
      deadline: dto.deadline.toString(),
    });
    const res = await service.createLendOffer(dto);
    expect(res.digest).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(rpc).toHaveBeenCalledWith(
      'insert_signed_lend_offer',
      expect.objectContaining({ p_digest: res.digest }),
    );
  });
});
