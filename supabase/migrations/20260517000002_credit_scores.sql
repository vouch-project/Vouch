DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'riskLevel') THEN
        CREATE TYPE "riskLevel" AS ENUM ('very_low', 'low', 'medium', 'high', 'very_high');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS credit_scores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- TODO: migrate walletAddress FK to userId uuid REFERENCES users(id) once #11 merges
    "walletAddress" address NOT NULL UNIQUE,
    score integer NOT NULL CHECK (score >= 0 AND score <= 1000),
    confidence numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    "riskLevel" "riskLevel" NOT NULL,
    factors jsonb NOT NULL DEFAULT '[]'::jsonb,
    "modelVersion" text NOT NULL,
    "scoredAt" timestamptz NOT NULL DEFAULT now(),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_scores_wallet_idx ON credit_scores ("walletAddress");
CREATE INDEX IF NOT EXISTS credit_scores_scored_at_idx ON credit_scores ("scoredAt");

CREATE TRIGGER update_credit_scores_updated_at BEFORE
UPDATE ON credit_scores FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE credit_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users"
ON credit_scores AS PERMISSIVE FOR SELECT TO public USING (true);
