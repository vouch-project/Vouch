-- Add price feed columns to tokens table.
-- All nullable: existing rows are not broken before prices are populated.
ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS price_usd          float8,
  ADD COLUMN IF NOT EXISTS volatility         float4,
  ADD COLUMN IF NOT EXISTS price_feed_address text;

-- Seed volatility for known symbols. price_usd will be populated by PriceFeedService.
-- price_feed_address is set per-environment via the API config (not stored in migration).
UPDATE public.tokens SET volatility = CASE symbol
  WHEN 'USDC'  THEN 0.02
  WHEN 'USDT'  THEN 0.03
  WHEN 'DAI'   THEN 0.04
  WHEN 'ETH'   THEN 0.45
  WHEN 'WETH'  THEN 0.45
  WHEN 'BTC'   THEN 0.50
  WHEN 'WBTC'  THEN 0.50
  WHEN 'LINK'  THEN 0.70
  WHEN 'UNI'   THEN 0.75
  WHEN 'AAVE'  THEN 0.65
  WHEN 'MOCK'  THEN 0.25
  ELSE 0.60
END
WHERE volatility IS NULL;
