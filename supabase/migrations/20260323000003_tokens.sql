CREATE TABLE IF NOT EXISTS tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "chainId" uuid NOT NULL REFERENCES chains (id),
    address address NOT NULL,
    symbol text NOT NULL,
    decimals smallint NOT NULL,
    name text,
    "logoURI" text
);

CREATE UNIQUE INDEX IF NOT EXISTS tokens_chainId_address_unique ON tokens ("chainId", address);

CREATE INDEX IF NOT EXISTS "tokens_chainId_idx" ON tokens ("chainId");

CREATE INDEX IF NOT EXISTS tokens_address_idx ON tokens (address);

CREATE INDEX IF NOT EXISTS tokens_symbol_idx ON tokens (symbol);
