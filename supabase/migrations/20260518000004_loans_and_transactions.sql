-- Extend the loans + transactions schema with the columns, enum values and
-- indexes introduced by this redesign.
-- Add the 'liquidated' value to the loan lifecycle, kept in chronological
-- order before 'cancelled'.
ALTER TYPE "loanStatus"
ADD VALUE IF NOT EXISTS 'liquidated' BEFORE 'cancelled';

-- New loan columns: free-form borrower context, per-state lifecycle
-- timestamps and a generic metadata bag.
ALTER TABLE loans
ADD COLUMN IF NOT EXISTS purpose text,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS "dueAt" timestamptz,
ADD COLUMN IF NOT EXISTS "fundedAt" timestamptz,
ADD COLUMN IF NOT EXISTS "repaidAt" timestamptz,
ADD COLUMN IF NOT EXISTS "liquidatedAt" timestamptz,
ADD COLUMN IF NOT EXISTS "cancelledAt" timestamptz,
ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Hot-path indexes for the marketplace ("open loans, newest first") and
-- general status filtering.
CREATE INDEX IF NOT EXISTS loans_status_idx ON loans (status);

CREATE INDEX IF NOT EXISTS loans_status_created_idx ON loans (status, "createdAt" DESC);
