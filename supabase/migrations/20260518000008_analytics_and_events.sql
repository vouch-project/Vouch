-- Operational + analytics tables.
--
-- `blockchain_event_log` is the deduplication / replay log for the chain
-- ingestion pipeline (apps/api/src/blockchain-listener). The listener writes
-- a row before processing each on-chain event; the unique index guarantees
-- idempotent handling even if the RPC delivers duplicates.
--
-- `analytics_events` is a generic event sink for product analytics, fed by
-- both the web client and the API.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'eventProcessingStatus') THEN
        CREATE TYPE "eventProcessingStatus" AS ENUM ('pending', 'processed', 'failed', 'skipped');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS blockchain_event_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "chainId" uuid NOT NULL REFERENCES chains (id),
    "eventName" text NOT NULL,
    "txHash" text NOT NULL,
    "blockNumber" uint256 NOT NULL,
    "blockHash" text NOT NULL,
    "logIndex" uint256 NOT NULL,
    "contractAddress" address NOT NULL,
    args jsonb NOT NULL DEFAULT '{}'::jsonb,
    status "eventProcessingStatus" NOT NULL DEFAULT 'pending',
    "processedAt" timestamptz,
    error text,
    "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS blockchain_event_log_unique ON blockchain_event_log ("chainId", "txHash", "logIndex");

CREATE INDEX IF NOT EXISTS blockchain_event_log_status_idx ON blockchain_event_log (status, "createdAt");

CREATE INDEX IF NOT EXISTS blockchain_event_log_event_name_idx ON blockchain_event_log ("eventName");

ALTER TABLE blockchain_event_log ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Generic analytics events.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_events (
    id bigserial PRIMARY KEY,
    "eventName" text NOT NULL,
    "actorAddress" address,
    "sessionId" text,
    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
    "occurredAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_name_idx ON analytics_events ("eventName");

CREATE INDEX IF NOT EXISTS analytics_events_actor_idx ON analytics_events ("actorAddress");

CREATE INDEX IF NOT EXISTS analytics_events_occurred_idx ON analytics_events ("occurredAt" DESC);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
