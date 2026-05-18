-- Social vouching: one wallet endorses another (optionally staking value
-- on-chain). Vouches are a primary input to the credit-scoring engine.
--
-- We track vouches as a directed relationship (voucher -> vouchee) and keep
-- the staked amount + status. The same pair may have at most one *active*
-- vouch; historical revoked ones are kept for auditability.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vouchStatus') THEN
        CREATE TYPE "vouchStatus" AS ENUM ('active', 'revoked', 'slashed', 'expired');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS vouches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "voucherAddress" address NOT NULL,
    "voucheeAddress" address NOT NULL,
    "chainId" uuid REFERENCES chains (id),
    "stakeTokenId" uuid REFERENCES tokens (id),
    "stakeAmount" text,
    -- 1..100 borrower's perceived trustworthiness as scored by voucher.
    "trustWeight" smallint NOT NULL DEFAULT 50 CHECK ("trustWeight" BETWEEN 1 AND 100),
    note text,
    status "vouchStatus" NOT NULL DEFAULT 'active',
    "onChainVouchId" uint256,
    "onChainTxHash" text,
    "revokedAt" timestamptz,
    "expiresAt" timestamptz,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    CHECK ("voucherAddress" <> "voucheeAddress")
);

CREATE UNIQUE INDEX IF NOT EXISTS vouches_active_unique ON vouches ("voucherAddress", "voucheeAddress")
WHERE
    status = 'active';

CREATE INDEX IF NOT EXISTS vouches_voucher_idx ON vouches ("voucherAddress");

CREATE INDEX IF NOT EXISTS vouches_vouchee_idx ON vouches ("voucheeAddress");

CREATE INDEX IF NOT EXISTS vouches_status_idx ON vouches (status);

CREATE TRIGGER update_vouches_updated_at BEFORE
UPDATE ON vouches FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();

ALTER TABLE vouches ENABLE ROW LEVEL SECURITY;
