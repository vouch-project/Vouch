-- ----------------------------------------------------------------------------
-- liquidate_loan_with_transaction(...)
-- Marks a loan as liquidated, records the liquidation transaction, and fans
-- out a notification to the borrower. Called by the blockchain listener upon
-- LoanLiquidated events.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.liquidate_loan_with_transaction (
    p_network_id          text,
    p_contract_address    address,
    p_on_chain_loan_id    uint256,
    p_liquidator_address  address,
    p_amount_paid         text,
    p_collateral_seized   text,
    p_principal_repaid    text,
    p_collateral_released text,
    p_tx_hash             text,
    p_block_number        uint256,
    p_block_hash          text,
    p_log_index           uint256,
    p_liquidated_at       timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
    v_chain_id            uuid;
    v_loan_id             uuid;
    v_principal_token_id  uuid;
    v_borrower_address    public.address;
    v_lender_address      public.address;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId"        = p_network_id
      AND "contractAddress"  = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: networkId=%, contractAddress=%',
            p_network_id, p_contract_address;
    END IF;

    SELECT id, "principalTokenId", "borrowerAddress", "lenderAddress"
    INTO v_loan_id, v_principal_token_id, v_borrower_address, v_lender_address
    FROM public.loans
    WHERE "onChainLoanId" = p_on_chain_loan_id
      AND "chainId"       = v_chain_id;

    IF v_loan_id IS NULL THEN
        RAISE EXCEPTION 'Loan not found: onChainLoanId=%, chainId=%',
            p_on_chain_loan_id, v_chain_id;
    END IF;

    IF v_principal_token_id IS NULL THEN
        RAISE EXCEPTION 'Loan % has no principal token set', v_loan_id;
    END IF;

    IF v_lender_address IS NULL THEN
        RAISE EXCEPTION 'Loan % has no lender set (loan not funded yet?)', v_loan_id;
    END IF;

    UPDATE public.loans
    SET status               = 'liquidated',
        "liquidatedAt"       = p_liquidated_at,
        "principalRepaid"    = GREATEST(COALESCE("principalRepaid"::numeric, 0), p_principal_repaid::numeric)::text,
        "collateralReleased" = GREATEST(COALESCE("collateralReleased"::numeric, 0), p_collateral_released::numeric)::text
    WHERE id     = v_loan_id
      AND status != 'liquidated';  -- idempotent: skip if already recorded

    -- No rows updated → duplicate event. Exit cleanly.
    IF NOT FOUND THEN
        RETURN;
    END IF;

    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_principal_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'liquidation', 'confirmed',
        p_liquidator_address, v_lender_address,
        p_amount_paid, p_log_index, p_liquidated_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;

    INSERT INTO public.notifications (
        "recipientAddress", type, title, body, "loanId", payload
    ) VALUES (
        v_borrower_address,
        'loan_liquidated',
        'Loan liquidated',
        'Your loan has been liquidated due to undercollateralization or expiry.',
        v_loan_id,
        jsonb_build_object(
            'amountPaid',       p_amount_paid,
            'collateralSeized', p_collateral_seized,
            'txHash',           p_tx_hash
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.liquidate_loan_with_transaction (
    text, address, uint256, address, text, text, text, text, text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.liquidate_loan_with_transaction (
    text, address, uint256, address, text, text, text, text, text, uint256, text, uint256, timestamptz
) TO service_role;
