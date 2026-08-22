-- ─── Enum ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signedOrderStatus') THEN
        CREATE TYPE "signedOrderStatus" AS ENUM ('open', 'filled', 'cancelled', 'expired');
    END IF;
END$$;

-- ─── Table: signed_loan_requests ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signed_loan_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    digest text NOT NULL,
    "chainId" uuid NOT NULL REFERENCES chains (id),
    "borrowerAddress" address NOT NULL,
    "collateralTokenId" uuid NOT NULL REFERENCES tokens (id),
    "collateralAmount" text NOT NULL,
    "principalTokenId" uuid NOT NULL REFERENCES tokens (id),
    "principalAmount" text NOT NULL,
    "interestRateBps" integer NOT NULL,
    duration interval NOT NULL,
    "maxLtvBps" integer NOT NULL,
    nonce text NOT NULL,
    deadline timestamptz NOT NULL,
    signature text NOT NULL,
    status "signedOrderStatus" NOT NULL DEFAULT 'open',
    "filledLoanId" uuid REFERENCES loans (id),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS signed_loan_requests_digest_unique ON signed_loan_requests (digest);

CREATE INDEX IF NOT EXISTS signed_loan_requests_borrower_idx ON signed_loan_requests ("borrowerAddress");

CREATE INDEX IF NOT EXISTS signed_loan_requests_status_deadline_idx ON signed_loan_requests (status, deadline);

CREATE TRIGGER update_signed_loan_requests_updated_at
BEFORE UPDATE ON signed_loan_requests FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();

ALTER TABLE signed_loan_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signed_loan_requests_public_read" ON public.signed_loan_requests FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

-- ─── Table: signed_lend_offers ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signed_lend_offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    digest text NOT NULL,
    "chainId" uuid NOT NULL REFERENCES chains (id),
    "lenderAddress" address NOT NULL,
    "principalTokenId" uuid NOT NULL REFERENCES tokens (id),
    "principalAmount" text NOT NULL,
    "collateralTokenId" uuid REFERENCES tokens (id),
    "collateralRatioBps" integer NOT NULL DEFAULT 15400,
    "trustedRatioBps" integer NOT NULL DEFAULT 0,
    "scoreThreshold" integer NOT NULL DEFAULT 0,
    "maxLtvBps" integer NOT NULL,
    "interestRateBps" integer NOT NULL,
    duration interval NOT NULL,
    nonce text NOT NULL,
    deadline timestamptz NOT NULL,
    signature text NOT NULL,
    status "signedOrderStatus" NOT NULL DEFAULT 'open',
    "filledLoanId" uuid REFERENCES loans (id),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS signed_lend_offers_digest_unique ON signed_lend_offers (digest);

CREATE INDEX IF NOT EXISTS signed_lend_offers_lender_idx ON signed_lend_offers ("lenderAddress");

CREATE INDEX IF NOT EXISTS signed_lend_offers_status_deadline_idx ON signed_lend_offers (status, deadline);

CREATE TRIGGER update_signed_lend_offers_updated_at
BEFORE UPDATE ON signed_lend_offers FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column ();

ALTER TABLE signed_lend_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signed_lend_offers_public_read" ON public.signed_lend_offers FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

-- ─── FK columns on loans ──────────────────────────────────────────────────────
ALTER TABLE loans
ADD COLUMN IF NOT EXISTS "signedLoanRequestId" uuid REFERENCES signed_loan_requests (id);

ALTER TABLE loans
ADD COLUMN IF NOT EXISTS "signedLendOfferId" uuid REFERENCES signed_lend_offers (id);

-- ─── Functions ───────────────────────────────────────────────────────────────
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION insert_signed_loan_request (
    p_network_id text,
    p_contract_address address,
    p_digest text,
    p_borrower_address address,
    p_collateral_token_address address,
    p_collateral_amount text,
    p_principal_token_address address,
    p_principal_amount text,
    p_interest_rate_bps integer,
    p_duration_seconds integer,
    p_max_ltv_bps integer,
    p_nonce text,
    p_deadline timestamptz,
    p_signature text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = '' AS $$
DECLARE
    v_chain_id uuid;
    v_collateral_token_id uuid;
    v_principal_token_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    SELECT id INTO v_collateral_token_id
    FROM public.tokens
    WHERE "chainId" = v_chain_id AND address = p_collateral_token_address;

    IF v_collateral_token_id IS NULL THEN
        RAISE EXCEPTION 'Collateral token not found: %', p_collateral_token_address;
    END IF;

    SELECT id INTO v_principal_token_id
    FROM public.tokens
    WHERE "chainId" = v_chain_id AND address = p_principal_token_address;

    IF v_principal_token_id IS NULL THEN
        RAISE EXCEPTION 'Principal token not found: %', p_principal_token_address;
    END IF;

    INSERT INTO public.signed_loan_requests (
        digest, "chainId", "borrowerAddress",
        "collateralTokenId", "collateralAmount",
        "principalTokenId", "principalAmount",
        "interestRateBps", duration, "maxLtvBps",
        nonce, deadline, signature, status
    ) VALUES (
        p_digest, v_chain_id, p_borrower_address,
        v_collateral_token_id, p_collateral_amount,
        v_principal_token_id, p_principal_amount,
        p_interest_rate_bps, make_interval(secs => p_duration_seconds), p_max_ltv_bps,
        p_nonce, p_deadline, p_signature, 'open'
    )
    ON CONFLICT (digest) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION insert_signed_loan_request (
    text,
    address,
    text,
    address,
    address,
    text,
    address,
    text,
    integer,
    integer,
    integer,
    text,
    timestamptz,
    text
)
FROM
    PUBLIC;

GRANT
EXECUTE ON FUNCTION insert_signed_loan_request (
    text,
    address,
    text,
    address,
    address,
    text,
    address,
    text,
    integer,
    integer,
    integer,
    text,
    timestamptz,
    text
) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION insert_signed_lend_offer (
    p_network_id text,
    p_contract_address address,
    p_digest text,
    p_lender_address address,
    p_principal_token_address address,
    p_principal_amount text,
    p_collateral_token_address address,
    p_collateral_ratio_bps integer,
    p_trusted_ratio_bps integer,
    p_score_threshold integer,
    p_max_ltv_bps integer,
    p_interest_rate_bps integer,
    p_duration_seconds integer,
    p_nonce text,
    p_deadline timestamptz,
    p_signature text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = '' AS $$
DECLARE
    v_chain_id uuid;
    v_principal_token_id uuid;
    v_collateral_token_id uuid;
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

    -- collateral token is nullable (ETH collateral = address(0) may have no token row)
    IF p_collateral_token_address IS NOT NULL THEN
        SELECT id INTO v_collateral_token_id
        FROM public.tokens
        WHERE "chainId" = v_chain_id AND address = p_collateral_token_address;
        -- intentionally allow NULL if token row absent (ETH collateral)
    END IF;

    INSERT INTO public.signed_lend_offers (
        digest, "chainId", "lenderAddress",
        "principalTokenId", "principalAmount",
        "collateralTokenId",
        "collateralRatioBps", "trustedRatioBps", "scoreThreshold",
        "maxLtvBps", "interestRateBps",
        duration, nonce, deadline, signature, status
    ) VALUES (
        p_digest, v_chain_id, p_lender_address,
        v_principal_token_id, p_principal_amount,
        v_collateral_token_id,
        p_collateral_ratio_bps, p_trusted_ratio_bps, p_score_threshold,
        p_max_ltv_bps, p_interest_rate_bps,
        make_interval(secs => p_duration_seconds), p_nonce, p_deadline, p_signature, 'open'
    )
    ON CONFLICT (digest) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION insert_signed_lend_offer (
    text,
    address,
    text,
    address,
    address,
    text,
    address,
    integer,
    integer,
    integer,
    integer,
    integer,
    integer,
    text,
    timestamptz,
    text
)
FROM
    PUBLIC;

GRANT
EXECUTE ON FUNCTION insert_signed_lend_offer (
    text,
    address,
    text,
    address,
    address,
    text,
    address,
    integer,
    integer,
    integer,
    integer,
    integer,
    integer,
    text,
    timestamptz,
    text
) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- fill_signed_order_with_transaction
--
-- p_order_kind: 'request' => signed_loan_requests (borrower-signed)
--               'offer'   => signed_lend_offers   (lender-signed)
--
-- When filling a loan request: the caller (lender) provides p_lender_address.
-- When filling a lend offer:   the caller (borrower) provides p_borrower_address.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_signed_order_with_transaction (
    p_network_id text,
    p_contract_address address,
    p_order_kind text,
    p_digest text,
    p_on_chain_loan_id uint256,
    p_filler_address address,
    p_collateral_token_address address,
    p_collateral_amount text,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_collateral_log_index uint256,
    p_disbursement_log_index uint256,
    p_filled_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = '' AS $$
DECLARE
    v_chain_id uuid;
    v_order_id uuid;
    v_principal_token_id uuid;
    v_collateral_token_id uuid;
    v_principal_amount text;
    v_lender_address public.address;
    v_borrower_address public.address;
    v_interest_rate_bps integer;
    v_duration interval;
    v_loan_id uuid;
    v_signed_loan_request_id uuid;
    v_signed_lend_offer_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    IF p_order_kind = 'request' THEN
        SELECT id, "principalTokenId", "principalAmount",
               "borrowerAddress", "interestRateBps", duration
        INTO v_order_id, v_principal_token_id, v_principal_amount,
             v_borrower_address, v_interest_rate_bps, v_duration
        FROM public.signed_loan_requests
        WHERE digest = p_digest AND "chainId" = v_chain_id;

        IF v_order_id IS NULL THEN
            RAISE EXCEPTION 'Signed loan request not found: digest=%, chainId=%', p_digest, v_chain_id;
        END IF;

        v_lender_address := p_filler_address;
        v_signed_loan_request_id := v_order_id;

    ELSIF p_order_kind = 'offer' THEN
        SELECT id, "principalTokenId", "principalAmount",
               "lenderAddress", "interestRateBps", duration
        INTO v_order_id, v_principal_token_id, v_principal_amount,
             v_lender_address, v_interest_rate_bps, v_duration
        FROM public.signed_lend_offers
        WHERE digest = p_digest AND "chainId" = v_chain_id;

        IF v_order_id IS NULL THEN
            RAISE EXCEPTION 'Signed lend offer not found: digest=%, chainId=%', p_digest, v_chain_id;
        END IF;

        v_borrower_address := p_filler_address;
        v_signed_lend_offer_id := v_order_id;

    ELSE
        RAISE EXCEPTION 'Invalid p_order_kind: %. Must be ''request'' or ''offer''.', p_order_kind;
    END IF;

    SELECT id INTO v_collateral_token_id
    FROM public.tokens
    WHERE "chainId" = v_chain_id AND address = p_collateral_token_address;

    IF v_collateral_token_id IS NULL THEN
        RAISE EXCEPTION 'Collateral token not found: %', p_collateral_token_address;
    END IF;

    -- Mark the order as filled; chain events are source-of-truth so status is overwritten unconditionally
    IF p_order_kind = 'request' THEN
        UPDATE public.signed_loan_requests SET status = 'filled' WHERE id = v_order_id;
    ELSE
        UPDATE public.signed_lend_offers SET status = 'filled' WHERE id = v_order_id;
    END IF;

    INSERT INTO public.loans (
        "onChainLoanId", "chainId", "borrowerAddress", "lenderAddress",
        "principalTokenId", "collateralTokenId",
        "principalAmount", "collateralAmount",
        "interestRate", duration,
        status, "startAt", "fundedAt", "dueAt",
        "signedLoanRequestId", "signedLendOfferId",
        "createdAt"
    ) VALUES (
        p_on_chain_loan_id, v_chain_id, v_borrower_address, v_lender_address,
        v_principal_token_id, v_collateral_token_id,
        v_principal_amount, p_collateral_amount,
        v_interest_rate_bps, v_duration,
        'active', p_filled_at, p_filled_at,
        CASE WHEN v_duration IS NOT NULL AND v_duration > interval '0'
             THEN p_filled_at + v_duration
             ELSE NULL
        END,
        v_signed_loan_request_id, v_signed_lend_offer_id,
        p_filled_at
    )
    ON CONFLICT ("chainId", "onChainLoanId") WHERE "onChainLoanId" IS NOT NULL DO NOTHING
    RETURNING id INTO v_loan_id;

    IF v_loan_id IS NULL THEN
        SELECT id INTO v_loan_id FROM public.loans
        WHERE "onChainLoanId" = p_on_chain_loan_id AND "chainId" = v_chain_id;
    END IF;

    -- Back-fill filledLoanId on the signed order row
    IF p_order_kind = 'request' THEN
        UPDATE public.signed_loan_requests SET "filledLoanId" = v_loan_id WHERE id = v_order_id;
    ELSE
        UPDATE public.signed_lend_offers SET "filledLoanId" = v_loan_id WHERE id = v_order_id;
    END IF;

    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_collateral_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'collateral_deposit', 'confirmed',
        v_borrower_address, p_contract_address,
        p_collateral_amount, p_collateral_log_index, p_filled_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;

    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_principal_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'loan_disbursement', 'confirmed',
        p_contract_address, v_borrower_address,
        v_principal_amount, p_disbursement_log_index, p_filled_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION fill_signed_order_with_transaction (
    text,
    address,
    text,
    text,
    uint256,
    address,
    address,
    text,
    text,
    uint256,
    text,
    uint256,
    uint256,
    timestamptz
)
FROM
    PUBLIC;

GRANT
EXECUTE ON FUNCTION fill_signed_order_with_transaction (
    text,
    address,
    text,
    text,
    uint256,
    address,
    address,
    text,
    text,
    uint256,
    text,
    uint256,
    uint256,
    timestamptz
) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_signed_order (
    p_network_id text,
    p_contract_address address,
    p_digest text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = '' AS $$
DECLARE
    v_chain_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    UPDATE public.signed_loan_requests
    SET status = 'cancelled'
    WHERE digest = p_digest AND "chainId" = v_chain_id AND status = 'open';

    UPDATE public.signed_lend_offers
    SET status = 'cancelled'
    WHERE digest = p_digest AND "chainId" = v_chain_id AND status = 'open';
END;
$$;

REVOKE ALL ON FUNCTION cancel_signed_order (text, address, text)
FROM
    PUBLIC;

GRANT
EXECUTE ON FUNCTION cancel_signed_order (text, address, text) TO service_role;
