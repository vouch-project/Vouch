DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loanStatus') THEN
        CREATE TYPE "loanStatus" AS ENUM ('pending', 'active', 'repaid', 'defaulted', 'cancelled');
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
    "principalAmount" uint256,
    "collateralAmount" uint256,
    "interestRate" uint256,
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

CREATE TRIGGER update_loans_updated_at BEFORE
UPDATE ON loans FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
