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
    "chainId" uuid NOT NULL REFERENCES chains (id),
    "tokenId" uuid NOT NULL REFERENCES tokens (id),
    "loanId" uuid NOT NULL REFERENCES loans (id),
    "txHash" text NOT NULL,
    "blockNumber" uint256,
    "blockHash" text,
    type "transactionType" NOT NULL,
    status "transactionStatus" NOT NULL DEFAULT 'pending',
    "fromAddress" address NOT NULL,
    "toAddress" address NOT NULL,
    amount uint256,
    "logIndex" uint256 NOT NULL,
    "txTimestamp" timestamptz NOT NULL,
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

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
