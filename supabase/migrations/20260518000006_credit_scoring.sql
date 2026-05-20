-- TODO: we have this credit_score and also in 20260517000002_credit_scores.sql

-- -- AI credit scoring storage.
-- --
-- -- The ML engine (apps/ml-engine) computes a credit score on demand. To make
-- -- the score auditable and the UI snappy we persist every scoring run as a
-- -- snapshot row in `credit_scores`, and the raw feature vector used to
-- -- produce it in `ml_feature_snapshots`.
-- --
-- -- `credit_scores` is append-only; a `latest` view (below) returns the most
-- -- recent score per address for hot-path reads.
-- CREATE TABLE IF NOT EXISTS credit_scores (
--     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--     address address NOT NULL,
--     score integer NOT NULL CHECK (score BETWEEN 0 AND 1000),
--     confidence numeric(5, 4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
--     "modelVersion" text NOT NULL,
--     factors jsonb NOT NULL DEFAULT '[]'::jsonb,
--     explanation text,
--     "computedAt" timestamptz NOT NULL DEFAULT now()
-- );

-- CREATE INDEX IF NOT EXISTS credit_scores_address_computed_idx ON credit_scores (address, "computedAt" DESC);

-- CREATE INDEX IF NOT EXISTS credit_scores_address_idx ON credit_scores (address);

-- ALTER TABLE credit_scores ENABLE ROW LEVEL SECURITY;

-- -- Convenience view: the latest score per address.
-- -- `security_invoker = true` (PG15+) makes the view run RLS as the querying
-- -- user, not the view owner — satisfying the "Security Definer View" lint.
-- CREATE OR REPLACE VIEW credit_scores_latest
-- WITH
--     (security_invoker = TRUE) AS
-- SELECT DISTINCT
--     ON (address) address,
--     score,
--     confidence,
--     "modelVersion",
--     factors,
--     explanation,
--     "computedAt"
-- FROM
--     credit_scores
-- ORDER BY
--     address,
--     "computedAt" DESC;

-- -- ----------------------------------------------------------------------------
-- -- Raw feature snapshots for model training + reproducibility.
-- -- The ml-training service (services/ml-training) consumes this table.
-- -- ----------------------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS ml_feature_snapshots (
--     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--     address address NOT NULL,
--     "featureSet" text NOT NULL, -- e.g. 'borrower_v1'
--     features jsonb NOT NULL, -- {feature_name: value, ...}
--     "sourceHash" text, -- hash of inputs for cache busting
--     "createdAt" timestamptz NOT NULL DEFAULT now()
-- );

-- CREATE INDEX IF NOT EXISTS ml_feature_snapshots_address_idx ON ml_feature_snapshots (address, "createdAt" DESC);

-- CREATE INDEX IF NOT EXISTS ml_feature_snapshots_feature_set_idx ON ml_feature_snapshots ("featureSet");

-- ALTER TABLE ml_feature_snapshots ENABLE ROW LEVEL SECURITY;
