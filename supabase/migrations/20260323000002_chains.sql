DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'addressType') THEN
        CREATE TYPE "addressType" AS ENUM ('evm', 'solana', 'bitcoin');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS chains (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "networkId" text NOT NULL,
    "networkType" "addressType" NOT NULL,
    "rpcUrl" text NOT NULL,
    name text,
    "contractAddress" address NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "chains_networkId_contract_address_unique" ON chains ("networkId", "contractAddress");

CREATE TRIGGER update_chains_updated_at BEFORE
UPDATE ON chains FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();
