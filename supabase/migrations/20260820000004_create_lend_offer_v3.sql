CREATE OR REPLACE FUNCTION create_lend_offer_with_transaction (
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
SET
    search_path = '' AS $$
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

REVOKE ALL ON FUNCTION create_lend_offer_with_transaction (
    text,
    address,
    uint256,
    address,
    address,
    text,
    integer,
    integer,
    integer,
    integer,
    integer,
    integer,
    timestamptz,
    text,
    uint256,
    text,
    uint256,
    timestamptz
)
FROM
    PUBLIC;

GRANT
EXECUTE ON FUNCTION create_lend_offer_with_transaction (
    text,
    address,
    uint256,
    address,
    address,
    text,
    integer,
    integer,
    integer,
    integer,
    integer,
    integer,
    timestamptz,
    text,
    uint256,
    text,
    uint256,
    timestamptz
) TO service_role;
