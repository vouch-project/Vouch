import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { ScoringService } from './scoring.service';

const MOCK_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

const MOCK_ML_RESPONSE = {
  address: MOCK_ADDRESS,
  score: 742,
  confidence: 0.87,
  modelVersion: 'v1',
  factors: ['wallet_age_days'],
  explanation: null,
  computedAt: new Date().toISOString(),
};

describe('ScoringService', () => {
  let service: ScoringService;
  let httpGetSpy: jest.Mock;

  beforeEach(async () => {
    httpGetSpy = jest.fn().mockReturnValue(of({ data: MOCK_ML_RESPONSE }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScoringService,
        {
          provide: HttpService,
          useValue: { get: httpGetSpy },
        },
      ],
    }).compile();

    service = module.get<ScoringService>(ScoringService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('calls ml-engine and returns score', async () => {
    const result = await service.getCreditScore(MOCK_ADDRESS);

    expect(httpGetSpy).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/score/${MOCK_ADDRESS.toLowerCase()}`),
    );
    expect(result.score).toBe(742);
    expect(result.address).toBe(MOCK_ADDRESS);
  });

  it('normalizes address to lowercase before calling ml-engine', async () => {
    await service.getCreditScore('0xABCDEF1234567890ABCDEF1234567890ABCDEF12');

    expect(httpGetSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/score/0xabcdef1234567890abcdef1234567890abcdef12',
      ),
    );
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
