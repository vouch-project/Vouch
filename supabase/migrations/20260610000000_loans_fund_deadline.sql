-- Funding window cutoff (createdAt + fundWindowSeconds) and cumulative principal repaid,
-- mirroring the on-chain VouchVault loan struct (V5 additions).
ALTER TABLE loans
ADD COLUMN IF NOT EXISTS "fundDeadline" timestamptz,
ADD COLUMN IF NOT EXISTS "principalRepaid" text;

-- Marketplace excludes expired-unfunded loans by filtering on fundDeadline; index it
-- alongside status for the common "pending and still fundable" query.
CREATE INDEX IF NOT EXISTS loans_fund_deadline_idx ON loans (status, "fundDeadline");
