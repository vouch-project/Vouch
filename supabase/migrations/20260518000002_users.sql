-- Off-chain user profile, keyed by wallet address.
--
-- The wallet is the source of truth for identity (the API authenticates by
-- signing a nonce). This table captures everything else the platform needs
-- to render rich UIs, drive analytics, and feed the credit-scoring engine.
--
-- Notes:
--   * `address` is stored lowercased; the application layer is responsible
--     for normalizing before insert.
--   * A row is created lazily the first time a wallet authenticates
--     (see `public.ensure_user`).
--   * KYC fields are nullable so anonymous wallets remain first-class.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kycStatus') THEN
        CREATE TYPE "kycStatus" AS ENUM ('none', 'pending', 'verified', 'rejected');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    address address NOT NULL UNIQUE,
    handle extensions.citext UNIQUE,
    "displayName" text,
    bio text,
    "avatarUrl" text,
    email extensions.citext UNIQUE,
    "emailVerified" boolean NOT NULL DEFAULT FALSE,
    "kycStatus" "kycStatus" NOT NULL DEFAULT 'none',
    "kycProvider" text,
    "kycReference" text,
    -- Denormalized aggregates kept in sync by triggers / background jobs so
    -- the UI can avoid expensive joins on hot paths.
    "reputationScore" integer NOT NULL DEFAULT 0,
    "totalLoansBorrowed" integer NOT NULL DEFAULT 0,
    "totalLoansFunded" integer NOT NULL DEFAULT 0,
    "totalVouchesGiven" integer NOT NULL DEFAULT 0,
    "totalVouchesReceived" integer NOT NULL DEFAULT 0,
    -- Free-form bag for app-specific preferences (UI theme, notification opt-ins, etc.).
    preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    "lastLoginAt" timestamptz,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_address_idx ON users (address);

CREATE INDEX IF NOT EXISTS users_handle_idx ON users (handle);

CREATE INDEX IF NOT EXISTS users_kyc_status_idx ON users ("kycStatus");

CREATE INDEX IF NOT EXISTS users_address_trgm_idx ON users USING gin (address extensions.gin_trgm_ops);

CREATE TRIGGER update_users_updated_at BEFORE
UPDATE ON users FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
