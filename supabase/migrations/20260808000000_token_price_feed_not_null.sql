-- Tokens must have a Chainlink feed to enter the system.
-- price_usd is removed: prices come from the live Chainlink poller (Redis cache)
-- and on-demand fetches in TokensService — the DB column was a redundant mirror.

-- Drop price_usd first (no dependents).
ALTER TABLE public.tokens DROP COLUMN IF EXISTS price_usd;

-- Make price_feed_address NOT NULL. Fail fast if any rows still have a NULL
-- feed — they must be backfilled or removed explicitly before this migration runs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tokens WHERE price_feed_address IS NULL) THEN
    RAISE EXCEPTION 'Cannot set tokens.price_feed_address NOT NULL: rows with NULL price_feed_address exist; backfill or delete dependent data explicitly before migrating.';
  END IF;
END $$;
ALTER TABLE public.tokens ALTER COLUMN price_feed_address SET NOT NULL;
