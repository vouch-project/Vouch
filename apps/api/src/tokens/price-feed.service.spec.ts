import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ethers } from 'ethers';
import { SupabaseService } from '../supabase/supabase.service';
import { PriceFeedService } from './price-feed.service';

jest.mock('ethers', () => {
  const actual = jest.requireActual<typeof import('ethers')>('ethers');
  return {
    ...actual,
    JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
  };
});

describe('PriceFeedService.getPriceForToken', () => {
  let service: PriceFeedService;
  let redis: { get: jest.Mock; set: jest.Mock };
  let contractSpy: jest.SpyInstance;
  let mockLatestRoundData: jest.Mock;
  let mockDecimals: jest.Mock;

  beforeEach(async () => {
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };

    mockLatestRoundData = jest.fn();
    mockDecimals = jest.fn();

    contractSpy = jest
      .spyOn(ethers, 'Contract' as any)
      .mockImplementation(() => ({
        latestRoundData: mockLatestRoundData,
        decimals: mockDecimals,
      }));

    const module = await Test.createTestingModule({
      providers: [
        PriceFeedService,
        { provide: SupabaseService, useValue: { client: {} } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        { provide: getRedisConnectionToken('default'), useValue: redis },
      ],
    }).compile();

    service = module.get(PriceFeedService);
  });

  afterEach(() => {
    contractSpy.mockRestore();
  });

  it('returns the parsed USD price for a valid fresh feed', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000) - 30); // 30s ago
    mockLatestRoundData.mockResolvedValue([1n, 200000000000n, 0n, now, 1n]);
    mockDecimals.mockResolvedValue(8n);

    const price = await service.getPriceForToken(
      'db-chain-id',
      '0xtoken',
      '0xfeed',
      'http://rpc',
    );
    expect(price).toBeCloseTo(2000, 1);
  });

  it('returns the price even when the feed is older than staleThresholdMs (first-time seed)', async () => {
    // getPriceForToken is called precisely when no cached price exists, so it
    // passes Infinity as the threshold — stale feeds are accepted to ensure the
    // cache is seeded on boot or after a new token is registered.
    const stale = BigInt(Math.floor(Date.now() / 1000) - 3700); // >1h ago
    mockLatestRoundData.mockResolvedValue([1n, 200000000000n, 0n, stale, 1n]);
    mockDecimals.mockResolvedValue(8n);

    const price = await service.getPriceForToken(
      'db-chain-id',
      '0xtoken',
      '0xfeed',
      'http://rpc',
    );
    expect(price).toBeCloseTo(2000, 1);
  });

  it('returns null when answer is zero', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000) - 30);
    mockLatestRoundData.mockResolvedValue([1n, 0n, 0n, now, 1n]);
    mockDecimals.mockResolvedValue(8n);

    const price = await service.getPriceForToken(
      'db-chain-id',
      '0xtoken',
      '0xfeed',
      'http://rpc',
    );
    expect(price).toBeNull();
  });

  it('returns null and does not throw when the RPC call rejects', async () => {
    mockLatestRoundData.mockRejectedValue(new Error('network error'));

    const price = await service.getPriceForToken(
      'db-chain-id',
      '0xtoken',
      '0xfeed',
      'http://rpc',
    );
    expect(price).toBeNull();
  });

  it('warms the Redis cache after a successful fetch', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000) - 30);
    mockLatestRoundData.mockResolvedValue([1n, 200000000000n, 0n, now, 1n]);
    mockDecimals.mockResolvedValue(8n);
    redis.get.mockResolvedValue(JSON.stringify({ 'other:0xother': 100 }));

    await service.getPriceForToken(
      'db-chain-id',
      '0xtoken',
      '0xfeed',
      'http://rpc',
    );

    // Default interval is 60s; TTL = ceil(60000/1000) + 10 (buffer) = 70
    expect(redis.set).toHaveBeenCalledWith(
      'prices:cache',
      expect.stringContaining('"db-chain-id:0xtoken"'),
      'EX',
      70,
    );
  });
});
