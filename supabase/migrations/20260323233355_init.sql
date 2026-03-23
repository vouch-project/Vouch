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

CREATE TABLE IF NOT EXISTS tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "chainId" uuid NOT NULL REFERENCES chains (id),
    address text NOT NULL,
    symbol text NOT NULL,
    decimals smallint NOT NULL,
    name text,
    "logoURI" text
);

CREATE UNIQUE INDEX IF NOT EXISTS tokens_chainId_address_unique ON tokens ("chainId", address);

CREATE INDEX IF NOT EXISTS "tokens_chainId_idx" ON tokens ("chainId");

CREATE INDEX IF NOT EXISTS tokens_address_idx ON tokens (address);

CREATE INDEX IF NOT EXISTS tokens_symbol_idx ON tokens (symbol);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loanStatus') THEN
        CREATE TYPE "loanStatus" AS ENUM ('pending', 'active', 'repaid', 'defaulted', 'cancelled');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS loans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "onChainLoanId" text,
    "chainId" uuid NOT NULL REFERENCES chains (id),
    "borrowerAddress" text NOT NULL,
    "lenderAddress" text,
    "initialTxHash" text,
    "principalTokenId" uuid REFERENCES tokens (id),
    "collateralTokenId" uuid REFERENCES tokens (id),
    "principalAmount" numeric(78, 0),
    "collateralAmount" numeric(78, 0),
    "interestRate" numeric(78, 0),
    duration interval,
    status "loanStatus" NOT NULL DEFAULT 'pending',
    "startAt" timestamptz,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS loans_chain_loan_unique ON loans ("chainId", "onChainLoanId")
WHERE
    "onChainLoanId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS loans_borrower_idx ON loans ("borrowerAddress");

CREATE INDEX IF NOT EXISTS loans_lender_idx ON loans ("lenderAddress");

CREATE INDEX IF NOT EXISTS loans_init_tx_idx ON loans ("initialTxHash");

CREATE TRIGGER update_loans_updated_at BEFORE
UPDATE ON loans FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transactionType') THEN
        CREATE TYPE "transactionType" AS ENUM ('collateral_deposit', 'loan_disbursement', 'repayment', 'liquidation', 'withdrawal');
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transactionStatus') THEN
        CREATE TYPE "transactionStatus" AS ENUM ('pending', 'confirmed', 'failed');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "loanId" uuid NOT NULL REFERENCES loans (id),
    "chainId" uuid NOT NULL REFERENCES chains (id),
    "tokenId" uuid REFERENCES tokens (id),
    "txHash" text NOT NULL,
    "blockNumber" bigint,
    "blockHash" text,
    type "transactionType" NOT NULL,
    status "transactionStatus" NOT NULL DEFAULT 'pending',
    "fromAddress" text,
    "toAddress" text,
    amount numeric(78, 0),
    "logIndex" integer NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "transactions_chain_tx_log_unique" ON transactions ("chainId", "txHash", "logIndex");

CREATE INDEX IF NOT EXISTS "transactions_loanId_idx" ON transactions ("loanId");

CREATE INDEX IF NOT EXISTS "transactions_chainId_idx" ON transactions ("chainId");

CREATE INDEX IF NOT EXISTS "transactions_tokenId_idx" ON transactions ("tokenId");

CREATE INDEX IF NOT EXISTS "transactions_txHash_idx" ON transactions ("txHash");

CREATE INDEX IF NOT EXISTS transactions_type_idx ON transactions (type);

CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions (status);

CREATE TRIGGER update_transactions_updated_at BEFORE
UPDATE ON transactions FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();
