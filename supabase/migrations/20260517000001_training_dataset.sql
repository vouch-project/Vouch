CREATE TABLE IF NOT EXISTS training_dataset (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- TODO: migrate walletAddress FK to userId uuid REFERENCES users(id) once #11 merges
    "walletAddress" address NOT NULL,
    "walletAgeDays" integer NOT NULL,
    "totalTransactions" integer NOT NULL,
    "historicalLiquidationCount" integer NOT NULL DEFAULT 0,
    "uniqueProtocolsUsed" integer NOT NULL DEFAULT 0,
    "wasLiquidated" boolean NOT NULL,
    "dataSource" text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_dataset_wallet_idx ON training_dataset ("walletAddress");
CREATE INDEX IF NOT EXISTS training_dataset_label_idx ON training_dataset ("wasLiquidated");

ALTER TABLE training_dataset ENABLE ROW LEVEL SECURITY;
