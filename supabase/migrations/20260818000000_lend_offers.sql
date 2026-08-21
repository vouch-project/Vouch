-- ─── Enum ────────────────────────────────────────────────────────────────────
CREATE TYPE "lendOfferStatus" AS ENUM ('pending', 'accepted', 'cancelled', 'expired');

-- ─── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE lend_offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "onChainOfferId" uint256 NOT NULL,
    "chainId" uuid NOT NULL REFERENCES chains (id),
    "lenderAddress" address NOT NULL,
    "principalTokenId" uuid NOT NULL REFERENCES tokens (id),
    "principalAmount" text NOT NULL,
    "collateralRatioBps" integer NOT NULL DEFAULT 15400,
    "trustedRatioBps" integer NOT NULL DEFAULT 0,
    "scoreThreshold" integer NOT NULL DEFAULT 0,
    "maxLtvBps" integer NOT NULL,
    "interestRateBps" integer NOT NULL,
    duration interval NOT NULL,
    "acceptDeadline" timestamptz NOT NULL,
    status "lendOfferStatus" NOT NULL DEFAULT 'pending',
    "acceptedLoanId" uuid REFERENCES loans (id),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX lend_offers_chain_offer_unique ON lend_offers ("chainId", "onChainOfferId");
CREATE INDEX lend_offers_lender_idx ON lend_offers ("lenderAddress");
CREATE INDEX lend_offers_status_deadline_idx ON lend_offers (status, "acceptDeadline");

CREATE TRIGGER update_lend_offers_updated_at
BEFORE UPDATE ON lend_offers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE lend_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lend_offers_public_read" ON public.lend_offers
    FOR SELECT TO anon, authenticated USING (TRUE);

-- ─── FK on loans ─────────────────────────────────────────────────────────────
ALTER TABLE loans ADD COLUMN "lendOfferId" uuid REFERENCES lend_offers (id);

-- ─── Functions ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_lend_offer_with_transaction(
    p_network_id text,
    p_contract_address address,
    p_on_chain_offer_id uint256,
    p_lender_address address,
    p_principal_token_address address,
    p_principal_amount text,
    p_collateral_ratio_bps integer,
    p_trusted_ratio_bps integer,
    p_score_threshold integer,
    p_max_ltv_bps integer,
    p_interest_rate_bps integer,
    p_duration_seconds integer,
    p_accept_deadline timestamptz,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_created_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
    v_chain_id uuid;
    v_principal_token_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    SELECT id INTO v_principal_token_id
    FROM public.tokens
    WHERE "chainId" = v_chain_id AND address = p_principal_token_address;

    IF v_principal_token_id IS NULL THEN
        RAISE EXCEPTION 'Principal token not found: %', p_principal_token_address;
    END IF;

    INSERT INTO public.lend_offers (
        "onChainOfferId", "chainId", "lenderAddress",
        "principalTokenId", "principalAmount",
        "collateralRatioBps", "trustedRatioBps", "scoreThreshold",
        "maxLtvBps", "interestRateBps",
        duration, "acceptDeadline", status, "createdAt"
    ) VALUES (
        p_on_chain_offer_id, v_chain_id, p_lender_address,
        v_principal_token_id, p_principal_amount,
        p_collateral_ratio_bps, p_trusted_ratio_bps, p_score_threshold,
        p_max_ltv_bps, p_interest_rate_bps,
        make_interval(secs => p_duration_seconds), p_accept_deadline,
        'pending', p_created_at
    )
    ON CONFLICT ("chainId", "onChainOfferId") DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION create_lend_offer_with_transaction(
    text, address, uint256, address, address, text,
    integer, integer, integer, integer, integer, integer,
    timestamptz, text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_lend_offer_with_transaction(
    text, address, uint256, address, address, text,
    integer, integer, integer, integer, integer, integer,
    timestamptz, text, uint256, text, uint256, timestamptz
) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION accept_lend_offer_with_transaction(
    p_network_id text,
    p_contract_address address,
    p_on_chain_offer_id uint256,
    p_on_chain_loan_id uint256,
    p_borrower_address address,
    p_collateral_token_address address,
    p_collateral_amount text,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_accepted_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
    v_chain_id uuid;
    v_offer_id uuid;
    v_principal_token_id uuid;
    v_collateral_token_id uuid;
    v_principal_amount text;
    v_lender_address public.address;
    v_interest_rate_bps integer;
    v_duration interval;
    v_loan_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    SELECT id, "principalTokenId", "principalAmount",
           "lenderAddress", "interestRateBps", duration
    INTO v_offer_id, v_principal_token_id, v_principal_amount,
         v_lender_address, v_interest_rate_bps, v_duration
    FROM public.lend_offers
    WHERE "onChainOfferId" = p_on_chain_offer_id AND "chainId" = v_chain_id;

    IF v_offer_id IS NULL THEN
        RAISE EXCEPTION 'Lend offer not found: onChainOfferId=%, chainId=%', p_on_chain_offer_id, v_chain_id;
    END IF;

    SELECT id INTO v_collateral_token_id
    FROM public.tokens
    WHERE "chainId" = v_chain_id AND address = p_collateral_token_address;

    IF v_collateral_token_id IS NULL THEN
        RAISE EXCEPTION 'Collateral token not found: %', p_collateral_token_address;
    END IF;

    UPDATE public.lend_offers SET status = 'accepted' WHERE id = v_offer_id;

    INSERT INTO public.loans (
        "onChainLoanId", "chainId", "borrowerAddress", "lenderAddress",
        "principalTokenId", "collateralTokenId",
        "principalAmount", "collateralAmount",
        "interestRate", duration,
        status, "startAt", "fundedAt", "dueAt", "lendOfferId", "createdAt"
    ) VALUES (
        p_on_chain_loan_id, v_chain_id, p_borrower_address, v_lender_address,
        v_principal_token_id, v_collateral_token_id,
        v_principal_amount, p_collateral_amount,
        v_interest_rate_bps, v_duration,
        'active', p_accepted_at, p_accepted_at,
        CASE WHEN v_duration IS NOT NULL AND v_duration > interval '0'
             THEN p_accepted_at + v_duration
             ELSE NULL
        END,
        v_offer_id, p_accepted_at
    )
    ON CONFLICT ("chainId", "onChainLoanId") WHERE "onChainLoanId" IS NOT NULL DO NOTHING
    RETURNING id INTO v_loan_id;

    IF v_loan_id IS NULL THEN
        SELECT id INTO v_loan_id FROM public.loans
        WHERE "onChainLoanId" = p_on_chain_loan_id AND "chainId" = v_chain_id;
    END IF;

    UPDATE public.lend_offers SET "acceptedLoanId" = v_loan_id WHERE id = v_offer_id;

    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_collateral_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'collateral_deposit', 'confirmed',
        p_borrower_address, p_contract_address,
        p_collateral_amount, p_log_index, p_accepted_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;

    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_principal_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'loan_disbursement', 'confirmed',
        p_contract_address, p_borrower_address,
        v_principal_amount, p_log_index + 1, p_accepted_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION accept_lend_offer_with_transaction(
    text, address, uint256, uint256, address, address, text, text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION accept_lend_offer_with_transaction(
    text, address, uint256, uint256, address, address, text, text, uint256, text, uint256, timestamptz
) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cancel_lend_offer_with_transaction(
    p_network_id text,
    p_contract_address address,
    p_on_chain_offer_id uint256,
    p_lender_address address,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_cancelled_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
    v_chain_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    UPDATE public.lend_offers
    SET status = 'cancelled'
    WHERE "onChainOfferId" = p_on_chain_offer_id AND "chainId" = v_chain_id
      AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION cancel_lend_offer_with_transaction(
    text, address, uint256, address, text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cancel_lend_offer_with_transaction(
    text, address, uint256, address, text, uint256, text, uint256, timestamptz
) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION expire_lend_offer_with_transaction(
    p_network_id text,
    p_contract_address address,
    p_on_chain_offer_id uint256,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_expired_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
    v_chain_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    UPDATE public.lend_offers
    SET status = 'expired'
    WHERE "onChainOfferId" = p_on_chain_offer_id AND "chainId" = v_chain_id
      AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION expire_lend_offer_with_transaction(
    text, address, uint256, text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION expire_lend_offer_with_transaction(
    text, address, uint256, text, uint256, text, uint256, timestamptz
) TO service_role;
