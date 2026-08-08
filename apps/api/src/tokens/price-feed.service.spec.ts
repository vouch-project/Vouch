import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ethers } from 'ethers';
import { SupabaseService } from '../supabase/supabase.service';
import { PriceFeedService, priceKey } from './price-feed.service';

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

  it('returns null when updatedAt is zero (round not complete), even with Infinity threshold', async () => {
    mockLatestRoundData.mockResolvedValue([1n, 200000000000n, 0n, 0n, 1n]);
    mockDecimals.mockResolvedValue(8n);

    const price = await service.getPriceForToken(
      'db-chain-id',
      '0xtoken',
      '0xfeed',
      'http://rpc',
    );
    expect(price).toBeNull();
  });
});

describe('PriceFeedService.refreshPrices staleness logic', () => {
  let service: PriceFeedService;
  let redis: { get: jest.Mock; set: jest.Mock };
  let contractSpy: jest.SpyInstance;
  let mockLatestRoundData: jest.Mock;
  let mockDecimals: jest.Mock;
  let supabaseSelect: jest.Mock;

  const CHAIN_ID = 'chain-abc';
  const ADDRESS = '0xaaaa';
  const FEED = '0xfeed';

  const makeModule = async (supabaseImpl: jest.Mock) => {
    const module = await Test.createTestingModule({
      providers: [
        PriceFeedService,
        {
          provide: SupabaseService,
          useValue: {
            client: { from: () => ({ select: supabaseImpl }) },
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        { provide: getRedisConnectionToken('default'), useValue: redis },
      ],
    }).compile();
    return module.get(PriceFeedService);
  };

  beforeEach(async () => {
    jest.useFakeTimers();
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

    supabaseSelect = jest.fn().mockResolvedValue({
      data: [
        {
          chainId: CHAIN_ID,
          address: ADDRESS,
          symbol: 'TKN',
          price_feed_address: FEED,
          chains: { rpcUrl: 'http://rpc' },
        },
      ],
      error: null,
    });
    service = await makeModule(supabaseSelect);
  });

  afterEach(() => {
    service.onModuleDestroy();
    contractSpy.mockRestore();
    jest.useRealTimers();
  });

  it('caches a stale feed when no prior price exists (Infinity threshold)', async () => {
    // Token not in Redis — should be seeded regardless of age
    redis.get.mockResolvedValue(null);
    const stale = BigInt(Math.floor(Date.now() / 1000) - 3700); // >1h ago
    mockLatestRoundData.mockResolvedValue([1n, 200000000000n, 0n, stale, 1n]);
    mockDecimals.mockResolvedValue(8n);

    await service.onModuleInit();

    expect(redis.set).toHaveBeenCalledWith(
      'prices:cache',
      expect.stringContaining(`"${priceKey(CHAIN_ID, ADDRESS)}"`),
      'EX',
      expect.any(Number),
    );
  });

  it('omits a stale feed when a prior price already exists (normal threshold enforced)', async () => {
    // Token already in Redis — staleness check applies
    redis.get.mockResolvedValue(
      JSON.stringify({ [priceKey(CHAIN_ID, ADDRESS)]: 1999 }),
    );
    const stale = BigInt(Math.floor(Date.now() / 1000) - 3700); // >1h ago
    mockLatestRoundData.mockResolvedValue([1n, 200000000000n, 0n, stale, 1n]);
    mockDecimals.mockResolvedValue(8n);

    await service.onModuleInit();

    // set should not be called because the refresh produced no prices
    expect(redis.set).not.toHaveBeenCalled();
  });
});
