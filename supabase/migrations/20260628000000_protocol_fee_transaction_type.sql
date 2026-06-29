-- ----------------------------------------------------------------------------
-- Add a dedicated `protocol_fee` transaction type so the on-chain protocol fee
-- (diverted from the interest portion to `protocolTreasury` on each repayment)
-- is recorded as its own ledger entry, instead of being silently folded into the
-- lender's `repayment` row.
--
-- `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that later
-- references the new value, so it lives in its own migration (its own
-- transaction). The functions that use it are added in the next migration.
-- ----------------------------------------------------------------------------
ALTER TYPE "transactionType"
ADD VALUE IF NOT EXISTS 'protocol_fee';
