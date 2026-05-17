import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';
import { ScoringService } from './scoring.service';

const MOCK_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

const MOCK_ML_RESPONSE = {
  address: MOCK_ADDRESS,
  score: 742,
  confidence: 0.87,
  risk_level: 'low',
  factors: ['wallet_age_days'],
  model_version: 'v1',
};

describe('ScoringService', () => {
  let service: ScoringService;
  let httpService: jest.Mocked<HttpService>;
  let supabaseService: { client: { from: jest.Mock } };

  beforeEach(async () => {
    const selectMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    });

    const upsertMock = jest.fn().mockResolvedValue({ error: null });

    supabaseService = {
      client: {
        from: jest.fn((table: string) => {
          if (table === 'credit_scores') return { select: selectMock, upsert: upsertMock };
          return {};
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScoringService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn().mockReturnValue(of({ data: MOCK_ML_RESPONSE })),
          },
        },
        { provide: SupabaseService, useValue: supabaseService },
      ],
    }).compile();

    service = module.get<ScoringService>(ScoringService);
    httpService = module.get(HttpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('calls ml-engine and upserts result when no cached score exists', async () => {
    const result = await service.getCreditScore(MOCK_ADDRESS);

    expect(httpService.get).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/score/${MOCK_ADDRESS}`),
    );
    expect(result.score).toBe(742);
    expect(result.riskLevel).toBe('low');
  });

  it('returns cached score when scoredAt is within 24h', async () => {
    const recentScore = {
      walletAddress: MOCK_ADDRESS,
      score: 600,
      confidence: 0.75,
      riskLevel: 'medium',
      factors: [],
      modelVersion: 'v1',
      scoredAt: new Date().toISOString(),
    };

    supabaseService.client.from = jest.fn(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: recentScore, error: null }),
        }),
      }),
      upsert: jest.fn().mockResolvedValue({ error: null }),
    }));

    const result = await service.getCreditScore(MOCK_ADDRESS);

    expect(httpService.get).not.toHaveBeenCalled();
    expect(result.score).toBe(600);
  });

  it('throws ServiceUnavailableException when ml-engine call fails', async () => {
    jest.spyOn(httpService, 'get').mockImplementation(() => {
      throw new Error('Connection refused');
    });

    await expect(service.getCreditScore(MOCK_ADDRESS)).rejects.toThrow(
      'Credit scoring service unavailable',
    );
  });
});
