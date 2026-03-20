CREATE TABLE IF NOT EXISTS token_list (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "chainId" bigint NOT NULL,
    address text NOT NULL,
    symbol text NOT NULL,
    name text,
    decimals integer,
    "logoURI" text,
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS token_list_chainId_address_unique ON token_list ("chainId", address);

CREATE INDEX IF NOT EXISTS "token_list_chainId_idx" ON token_list ("chainId");

CREATE INDEX IF NOT EXISTS token_list_address_idx ON token_list (address);

CREATE INDEX IF NOT EXISTS token_list_symbol_idx ON token_list (symbol);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loan_status') THEN
        CREATE TYPE loan_status AS ENUM ('pending', 'active', 'repaid', 'defaulted', 'cancelled');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS loans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    borrower text NOT NULL,
    "chainId" bigint NOT NULL DEFAULT 1,
    status loan_status NOT NULL DEFAULT 'pending',
    "collateralAmount" numeric NOT NULL,
    "collateralTxHash" text,
    "collateralBlockNumber" bigint,
    "collateralBlockHash" text,
    "collateralLockedAt" timestamptz,
    "collateralTokenId" uuid NOT NULL REFERENCES token_list (id),
    "createdAt" timestamptz NOT NULL DEFAULT now()
);