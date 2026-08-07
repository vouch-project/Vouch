-- Tokens must have a Chainlink feed to enter the system.
-- price_usd is removed: prices come from the live Chainlink poller (Redis cache)
-- and on-demand fetches in TokensService — the DB column was a redundant mirror.

-- Drop price_usd first (no dependents).
ALTER TABLE public.tokens DROP COLUMN IF EXISTS price_usd;

-- Make price_feed_address NOT NULL. Any existing row without a feed address
-- cannot have a price and should not exist — delete them first.
DELETE FROM public.tokens WHERE price_feed_address IS NULL;
ALTER TABLE public.tokens ALTER COLUMN price_feed_address SET NOT NULL;
