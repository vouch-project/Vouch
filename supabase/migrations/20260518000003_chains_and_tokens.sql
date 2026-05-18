-- Chains + tokens registry. One row per supported network and per supported
-- ERC-20 (or native) asset on that network.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'addressType') THEN
        CREATE TYPE "addressType" AS ENUM ('evm', 'solana', 'bitcoin');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS chains (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "networkId" text NOT NULL UNIQUE,
    "networkType" "addressType" NOT NULL,
    "rpcUrl" text NOT NULL,
    name text,
    "contractAddress" address NOT NULL,
    "blockExplorerUrl" text,
    "isTestnet" boolean NOT NULL DEFAULT FALSE,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_chains_updated_at BEFORE
UPDATE ON chains FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();

ALTER TABLE chains ENABLE ROW LEVEL SECURITY;

-- Tokens are scoped per chain (same symbol can exist on multiple networks).
CREATE TABLE IF NOT EXISTS tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "chainId" uuid NOT NULL REFERENCES chains (id) ON DELETE CASCADE,
    address address NOT NULL,
    symbol text NOT NULL,
    decimals smallint NOT NULL,
    name text,
    "logoURI" text,
    "isNative" boolean NOT NULL DEFAULT FALSE,
    "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tokens_chainId_address_unique ON tokens ("chainId", address);

CREATE INDEX IF NOT EXISTS "tokens_chainId_idx" ON tokens ("chainId");

CREATE INDEX IF NOT EXISTS tokens_address_idx ON tokens (address);

CREATE INDEX IF NOT EXISTS tokens_symbol_idx ON tokens (symbol);

ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;
