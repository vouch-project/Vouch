-- Store the LTV attestation alongside the signed loan request so lenders can
-- fill using the original attestation instead of re-fetching one that may
-- reflect a slightly different credit score.

ALTER TABLE public.signed_loan_requests
  ADD COLUMN IF NOT EXISTS "ltvAttestationMaxLtvBps" integer,
  ADD COLUMN IF NOT EXISTS "ltvAttestationExpiry" bigint,
  ADD COLUMN IF NOT EXISTS "ltvAttestationSig" text;

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
    p_signature text,
    p_ltv_attestation_max_ltv_bps integer DEFAULT NULL,
    p_ltv_attestation_expiry bigint DEFAULT NULL,
    p_ltv_attestation_sig text DEFAULT NULL
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
        nonce, deadline, signature, status,
        "ltvAttestationMaxLtvBps", "ltvAttestationExpiry", "ltvAttestationSig"
    ) VALUES (
        p_digest, v_chain_id, p_borrower_address,
        v_collateral_token_id, p_collateral_amount,
        v_principal_token_id, p_principal_amount,
        p_interest_rate_bps, make_interval(secs => p_duration_seconds), p_max_ltv_bps,
        p_nonce, p_deadline, p_signature, 'open',
        p_ltv_attestation_max_ltv_bps, p_ltv_attestation_expiry, p_ltv_attestation_sig
    )
    ON CONFLICT (digest) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION insert_signed_loan_request (
    text, address, text, address, address, text, address, text,
    integer, integer, integer, text, timestamptz, text,
    integer, bigint, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION insert_signed_loan_request (
    text, address, text, address, address, text, address, text,
    integer, integer, integer, text, timestamptz, text,
    integer, bigint, text
) TO service_role;
