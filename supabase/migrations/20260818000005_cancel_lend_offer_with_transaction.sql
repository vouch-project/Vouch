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
