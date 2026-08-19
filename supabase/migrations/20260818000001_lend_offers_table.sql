CREATE TABLE IF NOT EXISTS lend_offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "onChainOfferId" uint256 NOT NULL,
    "chainId" uuid NOT NULL REFERENCES chains (id),
    "lenderAddress" address NOT NULL,
    "principalTokenId" uuid NOT NULL REFERENCES tokens (id),
    "principalAmount" text NOT NULL,
    "collateralTokenId" uuid NOT NULL REFERENCES tokens (id),
    "minCollateralAmount" text NOT NULL,
    "maxLtvBps" integer NOT NULL,
    "interestRateBps" integer NOT NULL,
    duration interval NOT NULL,
    "acceptDeadline" timestamptz NOT NULL,
    status "lendOfferStatus" NOT NULL DEFAULT 'pending',
    "acceptedLoanId" uuid REFERENCES loans (id),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lend_offers_chain_offer_unique
    ON lend_offers ("chainId", "onChainOfferId");

CREATE INDEX IF NOT EXISTS lend_offers_lender_idx ON lend_offers ("lenderAddress");
CREATE INDEX IF NOT EXISTS lend_offers_status_deadline_idx ON lend_offers (status, "acceptDeadline");

CREATE TRIGGER update_lend_offers_updated_at
BEFORE UPDATE ON lend_offers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE lend_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lend_offers_public_read" ON public.lend_offers;

CREATE POLICY "lend_offers_public_read" ON public.lend_offers FOR
SELECT
    TO anon,
    authenticated USING (TRUE);
