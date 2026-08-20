-- Replace fixed collateralTokenId + minCollateralAmount with a ratio-based model.
-- The borrower now picks any token with a price feed at accept time.
ALTER TABLE lend_offers
DROP COLUMN IF EXISTS "collateralTokenId",
DROP COLUMN IF EXISTS "minCollateralAmount",
ADD COLUMN IF NOT EXISTS "collateralRatioBps" integer NOT NULL DEFAULT 15400;
