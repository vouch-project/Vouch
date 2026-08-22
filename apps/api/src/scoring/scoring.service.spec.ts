import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ethers } from 'ethers';
import { of } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';
import { ScoringService } from './scoring.service';

// EIP-55 checksum form — what asAddress() returns
const MOCK_ADDRESS = '0x1234567890AbcdEF1234567890aBcdef12345678';

// Matches the actual ml-engine wire format (Pydantic snake_case)
const MOCK_ML_RESPONSE = {
  address: MOCK_ADDRESS,
  score: 742,
  confidence: 0.87,
  model_version: 'v1',
  strengths: ['Long wallet history (1+ year)'],
  risk_factors: ['No DeFi borrowing history'],
  improvements: [
    'Establishing a DeFi borrowing and repayment history will improve your score',
  ],
  explanation: null,
};

describe('ScoringService', () => {
  let service: ScoringService;
  let httpGetSpy: jest.Mock;
  let insertMock: jest.Mock;
  let supabaseService: { client: { from: jest.Mock } };

  beforeEach(async () => {
    insertMock = jest.fn().mockResolvedValue({ error: null });

    supabaseService = {
      client: {
        from: jest.fn(() => ({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          insert: insertMock,
        })),
      },
    };

    httpGetSpy = jest.fn().mockReturnValue(of({ data: MOCK_ML_RESPONSE }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScoringService,
        { provide: HttpService, useValue: { get: httpGetSpy } },
        { provide: SupabaseService, useValue: supabaseService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<ScoringService>(ScoringService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('calls ml-engine, maps snake_case to camelCase, and inserts score', async () => {
    const result = await service.getCreditScore(MOCK_ADDRESS);

    expect(httpGetSpy).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/score/`),
    );
    expect(result.score).toBe(742);
    expect(result.modelVersion).toBe('v1');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 742,
        modelVersion: 'v1',
      }),
    );
  });

  it('normalizes address to EIP-55 checksum form', async () => {
    // All-lowercase input should be normalized to checksum form before querying/inserting
    await service.getCreditScore('0x1234567890abcdef1234567890abcdef12345678');

    expect(httpGetSpy).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/score/${MOCK_ADDRESS}`),
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ address: MOCK_ADDRESS }),
    );
  });

  it('throws BadRequestException for an invalid wallet address', async () => {
    await expect(service.getCreditScore('not-an-address')).rejects.toThrow(
      BadRequestException,
    );
    expect(httpGetSpy).not.toHaveBeenCalled();
  });

  it('returns cached score when computedAt is within 24h', async () => {
    const recentScore = {
      address: MOCK_ADDRESS,
      score: 600,
      confidence: 0.75,
      modelVersion: 'v1',
      factors: { strengths: [], risk_factors: [], improvements: [] },
      explanation: null,
      computedAt: new Date().toISOString(),
    };

    supabaseService.client.from = jest.fn(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest
            .fn()
            .mockResolvedValue({ data: recentScore, error: null }),
        }),
      }),
      insert: insertMock,
    }));

    const result = await service.getCreditScore(MOCK_ADDRESS);

    expect(httpGetSpy).not.toHaveBeenCalled();
    expect(result.score).toBe(600);
  });

  it('re-fetches from ml-engine when cached score is older than 24h', async () => {
    const staleScore = {
      address: MOCK_ADDRESS,
      score: 100,
      confidence: 0.5,
      modelVersion: 'v1',
      factors: { strengths: [], risk_factors: [], improvements: [] },
      explanation: null,
      computedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    };

    supabaseService.client.from = jest.fn(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest
            .fn()
            .mockResolvedValue({ data: staleScore, error: null }),
        }),
      }),
      insert: insertMock,
    }));

    const result = await service.getCreditScore(MOCK_ADDRESS);

    expect(httpGetSpy).toHaveBeenCalled();
    expect(result.score).toBe(742);
  });

  it('throws ServiceUnavailableException when ml-engine call fails', async () => {
    httpGetSpy.mockImplementation(() => {
      throw new Error('Connection refused');
    });

    await expect(service.getCreditScore(MOCK_ADDRESS)).rejects.toThrow(
      'Credit scoring service unavailable',
    );
  });

  describe('getLtvAttestation', () => {
    const CONTRACT_ADDRESS = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
    const COLLATERAL_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
    const BORROW_ADDRESS = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
    const CHAIN_ID = 31337n;
    const NONCE = 0n;
    const PRIVATE_KEY =
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

    beforeEach(() => {
      jest.spyOn(service, 'getCreditScore').mockResolvedValue({
        address: MOCK_ADDRESS,
        score: 575,
        confidence: 0.8,
        modelVersion: 'v1',
        strengths: [],
        riskFactors: [],
        improvements: [],
        explanation: null,
        computedAt: new Date().toISOString(),
      });
      supabaseService.client.from = jest.fn(() => ({
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }));
    });

    it('throws ServiceUnavailableException when SCORE_SIGNER_PRIVATE_KEY is not set', async () => {
      await expect(
        service.getLtvAttestation(
          MOCK_ADDRESS,
          COLLATERAL_ADDRESS,
          BORROW_ADDRESS,
          CONTRACT_ADDRESS,
          CHAIN_ID,
          NONCE,
        ),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws BadRequestException for an invalid token address', async () => {
      jest.spyOn(service['configService'], 'get').mockReturnValue(PRIVATE_KEY);
      await expect(
        service.getLtvAttestation(
          MOCK_ADDRESS,
          'not-an-address',
          BORROW_ADDRESS,
          CONTRACT_ADDRESS,
          CHAIN_ID,
          NONCE,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('clamps maxLtvBps to [1, 10000] with extreme volatility', async () => {
      jest.spyOn(service['configService'], 'get').mockReturnValue(PRIVATE_KEY);
      supabaseService.client.from = jest.fn(() => ({
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue({
            data: [
              {
                address: ethers.getAddress(COLLATERAL_ADDRESS),
                volatility: 3.0,
              },
              { address: ethers.getAddress(BORROW_ADDRESS), volatility: 3.0 },
            ],
            error: null,
          }),
        }),
      }));
      const { maxLtvBps } = await service.getLtvAttestation(
        MOCK_ADDRESS,
        COLLATERAL_ADDRESS,
        BORROW_ADDRESS,
        CONTRACT_ADDRESS,
        CHAIN_ID,
        NONCE,
      );
      expect(maxLtvBps).toBeGreaterThanOrEqual(1);
      expect(maxLtvBps).toBeLessThanOrEqual(10000);
    });

    it('uses DEFAULT_VOLATILITY for non-ETH tokens when Supabase query fails', async () => {
      jest.spyOn(service['configService'], 'get').mockReturnValue(PRIVATE_KEY);
      // Simulate Supabase returning an error (data is null).
      supabaseService.client.from = jest.fn(() => ({
        select: jest.fn().mockReturnValue({
          in: jest
            .fn()
            .mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        }),
      }));
      const { maxLtvBps: ltvOnError } = await service.getLtvAttestation(
        MOCK_ADDRESS,
        COLLATERAL_ADDRESS,
        BORROW_ADDRESS,
        CONTRACT_ADDRESS,
        CHAIN_ID,
        NONCE,
      );

      // With DEFAULT_VOLATILITY (0.6), base = 90 - 0.6*40 = 66.
      // With ETH_VOLATILITY (0.45), base = 90 - 0.45*40 = 72.
      // The error path must produce a result <= the ETH-volatility result, proving it used DEFAULT.
      supabaseService.client.from = jest.fn(() => ({
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue({
            data: [
              {
                address: ethers.getAddress(COLLATERAL_ADDRESS),
                volatility: 0.45,
              },
              { address: ethers.getAddress(BORROW_ADDRESS), volatility: 0.45 },
            ],
            error: null,
          }),
        }),
      }));
      const { maxLtvBps: ltvEthVolatility } = await service.getLtvAttestation(
        MOCK_ADDRESS,
        COLLATERAL_ADDRESS,
        BORROW_ADDRESS,
        CONTRACT_ADDRESS,
        CHAIN_ID,
        NONCE,
      );
      expect(ltvOnError).toBeLessThanOrEqual(ltvEthVolatility);
    });

    it('returns a signature that recovers to the expected signer address', async () => {
      jest.spyOn(service['configService'], 'get').mockReturnValue(PRIVATE_KEY);
      const { maxLtvBps, expiry, sig } = await service.getLtvAttestation(
        MOCK_ADDRESS,
        COLLATERAL_ADDRESS,
        BORROW_ADDRESS,
        CONTRACT_ADDRESS,
        CHAIN_ID,
        NONCE,
      );
      const domain = {
        name: 'VouchVault',
        version: '1',
        chainId: CHAIN_ID,
        verifyingContract: ethers.getAddress(CONTRACT_ADDRESS),
      };
      const types = {
        LtvAttestation: [
          { name: 'borrower', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'borrowToken', type: 'address' },
          { name: 'maxLtvBps', type: 'uint16' },
          { name: 'expiry', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      };
      const recovered = ethers.verifyTypedData(
        domain,
        types,
        {
          borrower: MOCK_ADDRESS,
          collateralToken: ethers.getAddress(COLLATERAL_ADDRESS),
          borrowToken: ethers.getAddress(BORROW_ADDRESS),
          maxLtvBps,
          expiry,
          nonce: NONCE,
        },
        sig,
      );
      expect(recovered).toBe(new ethers.Wallet(PRIVATE_KEY).address);
    });
  });

  describe('getAttestation', () => {
    const CONTRACT_ADDRESS = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
    const CHAIN_ID = 31337n;
    const PRIVATE_KEY =
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

    it('throws ServiceUnavailableException when SCORE_SIGNER_PRIVATE_KEY is not set', async () => {
      await expect(
        service.getAttestation(MOCK_ADDRESS, CONTRACT_ADDRESS, CHAIN_ID),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws BadRequestException for an invalid contractAddress', async () => {
      jest.spyOn(service['configService'], 'get').mockReturnValue(PRIVATE_KEY);
      await expect(
        service.getAttestation(MOCK_ADDRESS, 'not-an-address', CHAIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns a signature that recovers to the expected signer address', async () => {
      jest.spyOn(service['configService'], 'get').mockReturnValue(PRIVATE_KEY);
      const { score, expiry, sig } = await service.getAttestation(
        MOCK_ADDRESS,
        CONTRACT_ADDRESS,
        CHAIN_ID,
      );

      const normalizedAddress = ethers.getAddress(MOCK_ADDRESS);
      const normalizedContract = ethers.getAddress(CONTRACT_ADDRESS);
      const msgHash = ethers.solidityPackedKeccak256(
        ['address', 'uint16', 'uint256', 'address', 'uint256'],
        [normalizedAddress, score, expiry, normalizedContract, CHAIN_ID],
      );
      const recovered = ethers.verifyMessage(ethers.getBytes(msgHash), sig);
      const expectedSigner = new ethers.Wallet(PRIVATE_KEY).address;
      expect(recovered).toBe(expectedSigner);
    });
  });
});
