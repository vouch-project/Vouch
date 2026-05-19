-- Extend the chains + tokens registry with the columns introduced by this
-- redesign.
ALTER TABLE chains
ADD COLUMN IF NOT EXISTS "blockExplorerUrl" text,
ADD COLUMN IF NOT EXISTS "isTestnet" boolean NOT NULL DEFAULT FALSE;

ALTER TABLE tokens
ADD COLUMN IF NOT EXISTS "isNative" boolean NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS "createdAt" timestamptz NOT NULL DEFAULT now();
