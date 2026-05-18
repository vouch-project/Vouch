-- Loans + on-chain transactions associated with them.
--
-- A loan row is created the moment the borrower locks collateral on-chain
-- (status = 'pending'). Once a lender funds the loan it becomes 'active',
-- then 'repaid', 'defaulted', 'liquidated' or 'cancelled' over its lifetime.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loanStatus') THEN
        CREATE TYPE "loanStatus" AS ENUM (
            'pending',     -- collateral locked, awaiting lender
            'active',      -- funded, principal disbursed
            'repaid',      -- borrower repaid in full
            'defaulted',   -- past due, awaiting liquidation
            'liquidated',  -- collateral seized
            'cancelled'    -- borrower withdrew before funding
        );
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS loans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "onChainLoanId" uint256,
    "chainId" uuid NOT NULL REFERENCES chains (id),
    "borrowerAddress" address NOT NULL,
    "lenderAddress" address,
    "principalTokenId" uuid REFERENCES tokens (id),
    "collateralTokenId" uuid REFERENCES tokens (id),
    "principalAmount" text,
    "collateralAmount" text,
    "interestRateBps" integer, -- basis points (10000 = 100%)
    duration interval,
    status "loanStatus" NOT NULL DEFAULT 'pending',
    -- Off-chain context provided by the borrower at request time.
    purpose text,
    description text,
    -- Lifecycle timestamps.
    "startAt" timestamptz,
    "dueAt" timestamptz,
    "fundedAt" timestamptz,
    "repaidAt" timestamptz,
    "liquidatedAt" timestamptz,
    "cancelledAt" timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS loans_chain_loan_unique ON loans ("chainId", "onChainLoanId")
WHERE
    "onChainLoanId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS loans_borrower_idx ON loans ("borrowerAddress");

CREATE INDEX IF NOT EXISTS loans_lender_idx ON loans ("lenderAddress");

CREATE INDEX IF NOT EXISTS loans_status_idx ON loans (status);

CREATE INDEX IF NOT EXISTS loans_status_created_idx ON loans (status, "createdAt" DESC);

CREATE TRIGGER update_loans_updated_at BEFORE
UPDATE ON loans FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Transactions: every chain event that affects a loan's lifecycle.
-- Used as the source of truth for analytics and as a deduplication log for
-- the blockchain listener (see the unique index on chainId+txHash+logIndex).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transactionType') THEN
        CREATE TYPE "transactionType" AS ENUM (
            'collateral_deposit',
            'loan_disbursement',
            'repayment',
            'liquidation',
            'withdrawal'
        );
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
    "loanId" uuid NOT NULL REFERENCES loans (id) ON DELETE CASCADE,
    "txHash" text NOT NULL,
    "blockNumber" uint256,
    "blockHash" text,
    type "transactionType" NOT NULL,
    status "transactionStatus" NOT NULL DEFAULT 'pending',
    "fromAddress" address NOT NULL,
    "toAddress" address NOT NULL,
    amount text,
    "logIndex" uint256 NOT NULL,
    "txTimestamp" timestamptz NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_chain_tx_log_unique ON transactions ("chainId", "txHash", "logIndex");

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
