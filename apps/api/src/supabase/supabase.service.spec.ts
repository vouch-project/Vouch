import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from './supabase.service';

const mockSupabaseClient = {
  from: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({ error: null }),
    }),
  }),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

describe('SupabaseService', () => {
  let service: SupabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SUPABASE_URL') return 'https://example.supabase.co';
              if (key === 'SUPABASE_SECRET_KEY') return 'test-secret-key';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SupabaseService>(SupabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
