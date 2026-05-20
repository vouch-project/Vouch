-- ETL output for the cold-start credit scoring training dataset.
--
-- Populated by the `services/ml-training` ETL pipeline, which scrapes Aave V3
-- liquidation history (positive class) plus Aave V3 borrowers that have never
-- been liquidated (negative class), enriches each wallet with on-chain
-- activity metrics, and upserts the result here.
--
-- The downstream XGBoost trainer in `services/ml-training/pipelines/` reads
-- this table to build the model that powers `apps/ml-engine`.
--
-- Re-run safety: the (address, chainId, featureSetVersion) UNIQUE constraint
-- + ON CONFLICT upsert means the ETL is idempotent. Bumping
-- `featureSetVersion` lets new feature schemas coexist with old datasets.

CREATE TABLE IF NOT EXISTS training_dataset (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    address address NOT NULL,
    "chainId" integer NOT NULL, -- 1=mainnet, 11155111=sepolia
    -- Label
    "labelIsRisky" boolean NOT NULL,
    "labelSource" text NOT NULL, -- 'aave_v3_liquidation' | 'aave_v3_safe_borrower'
    "snapshotAt" timestamptz NOT NULL, -- features computed as-of this time (for reproducibility)
    -- Core features
    "walletAgeDays" integer,
    "totalTransactions" integer,
    "historicalLiquidationCount" integer,
    "aaveBorrowsCount" integer,
    "aaveTotalBorrowedUsd" numeric(30, 2),
    "ethBalance" numeric(38, 18),
    "stablecoinBalanceUsd" numeric(30, 2),
    "uniqueProtocolsInteracted" integer,
    -- Escape hatch for ad-hoc features that haven't earned a column yet
    "rawFeatures" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "featureSetVersion" text NOT NULL DEFAULT 'cold_start_v1',
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT training_dataset_unique_addr_chain_version
        UNIQUE (address, "chainId", "featureSetVersion")
);

CREATE INDEX IF NOT EXISTS training_dataset_label_idx
    ON training_dataset ("labelIsRisky");

CREATE INDEX IF NOT EXISTS training_dataset_feature_set_idx
    ON training_dataset ("featureSetVersion");

CREATE INDEX IF NOT EXISTS training_dataset_chain_idx
    ON training_dataset ("chainId");

CREATE TRIGGER update_training_dataset_updated_at BEFORE
UPDATE ON training_dataset FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();

ALTER TABLE training_dataset ENABLE ROW LEVEL SECURITY;
-- No public read policy: only the service role (which bypasses RLS) should
-- touch this table. The trained model + per-address `credit_scores` are the
-- public-facing artifacts.
