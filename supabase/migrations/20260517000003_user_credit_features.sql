CREATE TABLE IF NOT EXISTS user_credit_features (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "walletAddress" address NOT NULL UNIQUE,
    "totalLoansTaken" integer NOT NULL DEFAULT 0,
    "totalLoansRepaid" integer NOT NULL DEFAULT 0,
    "totalLoansDefaulted" integer NOT NULL DEFAULT 0,
    "onTimeRepaymentRate" numeric(4,3) CHECK ("onTimeRepaymentRate" >= 0 AND "onTimeRepaymentRate" <= 1),
    "avgHealthFactorMaintained" numeric(6,4) CHECK ("avgHealthFactorMaintained" >= 0),
    "lastUpdatedAt" timestamptz,
    "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- RLS enabled; no public policy by design — this table is written by NestJS using the
-- service_role key, which bypasses RLS. No authenticated/anon access intended.
ALTER TABLE user_credit_features ENABLE ROW LEVEL SECURITY;
