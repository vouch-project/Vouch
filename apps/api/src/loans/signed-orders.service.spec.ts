import { Test } from '@nestjs/testing';
import { ethers } from 'ethers';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateSignedLendOfferDto } from './dto/create-signed-lend-offer.dto';
import { CreateSignedLoanRequestDto } from './dto/create-signed-loan-request.dto';
import { buildDomain, LEND_OFFER_TYPES, LOAN_REQUEST_TYPES } from './eip712';
import { SignedOrdersService } from './signed-orders.service';

describe('SignedOrdersService', () => {
  const rpc = jest.fn().mockResolvedValue({ error: null });
  const supabase = { client: { rpc } } as unknown as SupabaseService;
  let service: SignedOrdersService;

  beforeEach(async () => {
    rpc.mockClear();
    const mod = await Test.createTestingModule({
      providers: [
        SignedOrdersService,
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();
    service = mod.get(SignedOrdersService);
  });

  it('rejects a request whose signature does not match borrower', async () => {
    const other = ethers.Wallet.createRandom();
    const base = {
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
    const domain = buildDomain(31337n, base.contractAddress);
    const signature = await other.signTypedData(domain, LOAN_REQUEST_TYPES, {
      borrower: base.borrowerAddress,
      collateralToken: base.collateralTokenAddress,
      collateralAmount: base.collateralAmount.toString(),
      principalToken: base.principalTokenAddress,
      principalAmount: base.principalAmount.toString(),
      interestRateBps: base.interestRateBps,
      durationSeconds: base.durationSeconds.toString(),
      maxLtvBps: base.maxLtvBps,
      nonce: base.nonce.toString(),
      deadline: base.deadline.toString(),
    });
    const dto: CreateSignedLoanRequestDto = { ...base, signature };
    await expect(service.createLoanRequest(dto)).rejects.toThrow(/signature/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stores a valid request via RPC', async () => {
    const wallet = ethers.Wallet.createRandom();
    const base = {
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
    const domain = buildDomain(31337n, base.contractAddress);
    const signature = await wallet.signTypedData(domain, LOAN_REQUEST_TYPES, {
      borrower: base.borrowerAddress,
      collateralToken: base.collateralTokenAddress,
      collateralAmount: base.collateralAmount.toString(),
      principalToken: base.principalTokenAddress,
      principalAmount: base.principalAmount.toString(),
      interestRateBps: base.interestRateBps,
      durationSeconds: base.durationSeconds.toString(),
      maxLtvBps: base.maxLtvBps,
      nonce: base.nonce.toString(),
      deadline: base.deadline.toString(),
    });
    const dto: CreateSignedLoanRequestDto = { ...base, signature };
    const res = await service.createLoanRequest(dto);
    expect(res.digest).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(rpc).toHaveBeenCalledWith(
      'insert_signed_loan_request',
      expect.objectContaining({ p_digest: res.digest }),
    );
  });

  it('rejects a loan request with an expired deadline', async () => {
    const wallet = ethers.Wallet.createRandom();
    const base = {
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
    const domain = buildDomain(31337n, base.contractAddress);
    const signature = await wallet.signTypedData(domain, LOAN_REQUEST_TYPES, {
      borrower: base.borrowerAddress,
      collateralToken: base.collateralTokenAddress,
      collateralAmount: base.collateralAmount.toString(),
      principalToken: base.principalTokenAddress,
      principalAmount: base.principalAmount.toString(),
      interestRateBps: base.interestRateBps,
      durationSeconds: base.durationSeconds.toString(),
      maxLtvBps: base.maxLtvBps,
      nonce: base.nonce.toString(),
      deadline: base.deadline.toString(),
    });
    const dto: CreateSignedLoanRequestDto = { ...base, signature };
    await expect(service.createLoanRequest(dto)).rejects.toThrow(/expired/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a lend offer whose signature does not match lender', async () => {
    const other = ethers.Wallet.createRandom();
    const base = {
      lenderAddress: '0x000000000000000000000000000000000000dEaD',
      principalTokenAddress: ethers.ZeroAddress,
      principalAmount: 500n,
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
    const domain = buildDomain(31337n, base.contractAddress);
    const signature = await other.signTypedData(domain, LEND_OFFER_TYPES, {
      lender: base.lenderAddress,
      principalToken: base.principalTokenAddress,
      principalAmount: base.principalAmount.toString(),
      collateralRatioBps: base.collateralRatioBps,
      trustedRatioBps: base.trustedRatioBps,
      scoreThreshold: base.scoreThreshold,
      maxLtvBps: base.maxLtvBps,
      interestRateBps: base.interestRateBps,
      durationSeconds: base.durationSeconds.toString(),
      nonce: base.nonce.toString(),
      deadline: base.deadline.toString(),
    });
    const dto: CreateSignedLendOfferDto = { ...base, signature };
    await expect(service.createLendOffer(dto)).rejects.toThrow(/signature/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stores a valid lend offer via RPC', async () => {
    const wallet = ethers.Wallet.createRandom();
    const base = {
      lenderAddress: wallet.address,
      principalTokenAddress: ethers.ZeroAddress,
      principalAmount: 500n,
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
    const domain = buildDomain(31337n, base.contractAddress);
    const signature = await wallet.signTypedData(domain, LEND_OFFER_TYPES, {
      lender: base.lenderAddress,
      principalToken: base.principalTokenAddress,
      principalAmount: base.principalAmount.toString(),
      collateralRatioBps: base.collateralRatioBps,
      trustedRatioBps: base.trustedRatioBps,
      scoreThreshold: base.scoreThreshold,
      maxLtvBps: base.maxLtvBps,
      interestRateBps: base.interestRateBps,
      durationSeconds: base.durationSeconds.toString(),
      nonce: base.nonce.toString(),
      deadline: base.deadline.toString(),
    });
    const dto: CreateSignedLendOfferDto = { ...base, signature };
    const res = await service.createLendOffer(dto);
    expect(res.digest).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(rpc).toHaveBeenCalledWith(
      'insert_signed_lend_offer',
      expect.objectContaining({ p_digest: res.digest }),
    );
  });
});
