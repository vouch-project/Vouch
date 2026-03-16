-- Migration: Create loans table
CREATE TABLE IF NOT EXISTS loans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    borrower text NOT NULL,
    collateral_amount numeric NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    active boolean NOT NULL DEFAULT TRUE
);
