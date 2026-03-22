DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'addressType') THEN
        CREATE TYPE "addressType" AS ENUM ('evm', 'solana', 'bitcoin');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS chains (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "networkId" bigint NOT NULL,
    "networkType" "addressType" NOT NULL,
    "rpcUrl" text NOT NULL,
    name text,
    "contractAddress" text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "chains_networkId_contract_address_unique" ON chains ("networkId", "contractAddress");

CREATE OR REPLACE FUNCTION update_updated_at_column () RETURNS TRIGGER AS $$
BEGIN
    IF NEW.* IS DISTINCT FROM OLD.* THEN
        NEW."updatedAt" = now();
    END IF;

   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_chains_updated_at BEFORE
UPDATE ON chains FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();

CREATE TABLE IF NOT EXISTS token_list (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "chainId" uuid NOT NULL REFERENCES chains (id),
    address text NOT NULL,
    symbol text NOT NULL,
    name text,
    decimals integer,
    "logoURI" text
);

CREATE UNIQUE INDEX IF NOT EXISTS token_list_chainId_address_unique ON token_list ("chainId", address);

CREATE INDEX IF NOT EXISTS "token_listChainId_idx" ON token_list ("chainId");

CREATE INDEX IF NOT EXISTS token_list_address_idx ON token_list (address);

CREATE INDEX IF NOT EXISTS token_list_symbol_idx ON token_list (symbol);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loanStatus') THEN
        CREATE TYPE "loanStatus" AS ENUM ('pending', 'active', 'repaid', 'defaulted', 'cancelled');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS loans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "loanId" numeric NOT NULL,
    borrower text NOT NULL,
    "chainId" uuid NOT NULL REFERENCES chains (id),
    status "loanStatus" NOT NULL DEFAULT 'pending',
    "collateralAmount" numeric NOT NULL,
    "collateralTxHash" text NOT NULL,
    "collateralBlockNumber" bigint NOT NULL,
    "collateralBlockHash" text NOT NULL,
    "collateralLockedAt" timestamptz NOT NULL,
    "collateralTokenId" uuid NOT NULL REFERENCES token_list (id),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS loans_chain_loan_unique ON loans ("chainId", "loanId");

CREATE INDEX IF NOT EXISTS loans_borrower_idx ON loans (borrower);

CREATE INDEX IF NOT EXISTS loans_status_idx ON loans (status);

CREATE INDEX IF NOT EXISTS "loans_chainId_idx" ON loans ("chainId");

CREATE TRIGGER update_loans_updated_at BEFORE
UPDATE ON loans FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();

CREATE OR REPLACE FUNCTION normalize_crypto_address () RETURNS TRIGGER AS $$
DECLARE
    v_network_type "addressType";
    v_addr TEXT;
    v_col_name TEXT;
    v_chain_id uuid;
BEGIN
    -- 1. Identify which column and network type we are dealing with
    IF TG_TABLE_NAME = 'chains' THEN
        v_network_type := NEW."networkType";
        v_col_name := 'contractAddress';
        v_addr := NEW."contractAddress";
    ELSE
        -- For token_list and loans, we look up the network type from the parent chain
        IF TG_TABLE_NAME = 'loans' THEN 
            v_col_name := 'borrower';
            v_addr := NEW.borrower;
            v_chain_id := NEW."chainId";
        ELSE 
            v_col_name := 'address';
            v_addr := NEW.address; 
            v_chain_id := NEW."chainId";
        END IF;
        SELECT "networkType" INTO v_network_type FROM chains WHERE id = v_chain_id;
    END IF;

    -- 2. Validation & Normalization Logic
    IF v_network_type IS NULL THEN
        RAISE EXCEPTION 'Invalid chainId: %, networkType not found.', v_chain_id;
    END IF;

    CASE v_network_type
        WHEN 'evm' THEN
            IF v_addr !~* '^0x[a-f0-9]{40}$' THEN 
                RAISE EXCEPTION 'Invalid EVM % format: %', v_col_name, v_addr; 
            END IF;
            v_addr := LOWER(v_addr);

        WHEN 'solana' THEN
            IF v_addr !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' THEN 
                RAISE EXCEPTION 'Invalid Solana %: %', v_col_name, v_addr; 
            END IF;

        WHEN 'bitcoin' THEN
            IF v_addr !~ '^(1|3|bc1)[a-zA-Z0-9]{25,62}$' THEN 
                RAISE EXCEPTION 'Invalid BTC %: %', v_col_name, v_addr; 
            END IF;
            IF v_addr ILIKE 'bc1%' THEN v_addr := LOWER(v_addr); END IF;
    END CASE;

    -- 3. Save the normalized value back to the record
    IF TG_TABLE_NAME = 'chains' THEN NEW."contractAddress" := v_addr;
    ELSIF TG_TABLE_NAME = 'loans' THEN NEW.borrower := v_addr;
    ELSE NEW.address := v_addr; END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_normalize_chain_contract_insert BEFORE INSERT ON chains FOR EACH ROW
EXECUTE FUNCTION normalize_crypto_address ();

CREATE TRIGGER trigger_normalize_chain_contract_update BEFORE
UPDATE OF "contractAddress",
"networkType" ON chains FOR EACH ROW WHEN (
    OLD."contractAddress" IS DISTINCT FROM NEW."contractAddress"
    OR OLD."networkType" IS DISTINCT FROM NEW."networkType"
)
EXECUTE FUNCTION normalize_crypto_address ();

CREATE TRIGGER trigger_normalize_token_address_insert BEFORE INSERT ON token_list FOR EACH ROW
EXECUTE FUNCTION normalize_crypto_address ();

CREATE TRIGGER trigger_normalize_token_address_update BEFORE
UPDATE OF address ON token_list FOR EACH ROW WHEN (OLD.address IS DISTINCT FROM NEW.address)
EXECUTE FUNCTION normalize_crypto_address ();

CREATE TRIGGER trigger_normalize_loan_borrower_insert BEFORE INSERT ON loans FOR EACH ROW
EXECUTE FUNCTION normalize_crypto_address ();

CREATE TRIGGER trigger_normalize_loan_borrower_update BEFORE
UPDATE OF borrower ON loans FOR EACH ROW WHEN (OLD.borrower IS DISTINCT FROM NEW.borrower)
EXECUTE FUNCTION normalize_crypto_address ();
