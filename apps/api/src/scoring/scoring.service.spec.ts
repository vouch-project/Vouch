import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';
import { ScoringService } from './scoring.service';

const MOCK_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

// Matches the actual ml-engine wire format (Pydantic snake_case)
const MOCK_ML_RESPONSE = {
  address: MOCK_ADDRESS,
  score: 742,
  confidence: 0.87,
  model_version: 'v1',
  factors: ['wallet_age_days'],
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
      expect.stringContaining(`/api/v1/score/${MOCK_ADDRESS.toLowerCase()}`),
    );
    expect(result.score).toBe(742);
    expect(result.modelVersion).toBe('v1');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOCK_ADDRESS.toLowerCase(),
        score: 742,
        modelVersion: 'v1',
      }),
    );
  });

  it('normalizes address to lowercase', async () => {
    await service.getCreditScore('0xABCDEF1234567890ABCDEF1234567890ABCDEF12');

    expect(httpGetSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/score/0xabcdef1234567890abcdef1234567890abcdef12',
      ),
    );
  });

  it('returns cached score when computedAt is within 24h', async () => {
    const recentScore = {
      address: MOCK_ADDRESS,
      score: 600,
      confidence: 0.75,
      modelVersion: 'v1',
      factors: [],
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
      factors: [],
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
});
