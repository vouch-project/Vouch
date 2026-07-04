-- ----------------------------------------------------------------------------
-- expire_loan_with_transaction(...)
-- Marks a pending loan as expired, sets "expiredAt", and records the on-chain
-- collateral return as a `withdrawal` transaction. Called by the blockchain
-- listener upon LoanExpired events.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_loan_with_transaction (
    p_network_id          text,
    p_contract_address    address,
    p_on_chain_loan_id    uint256,
    p_borrower_address    address,
    p_tx_hash             text,
    p_block_number        uint256,
    p_block_hash          text,
    p_log_index           uint256,
    p_expired_at          timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
    v_chain_id             uuid;
    v_loan_id              uuid;
    v_collateral_token_id  uuid;
    v_collateral_amount    text;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId"        = p_network_id
      AND "contractAddress"  = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: networkId=%, contractAddress=%',
            p_network_id, p_contract_address;
    END IF;

    SELECT id, "collateralTokenId", "collateralAmount"
    INTO v_loan_id, v_collateral_token_id, v_collateral_amount
    FROM public.loans
    WHERE "onChainLoanId"   = p_on_chain_loan_id
      AND "chainId"         = v_chain_id
      AND "borrowerAddress" = p_borrower_address;

    IF v_loan_id IS NULL THEN
        RAISE EXCEPTION 'Loan not found: onChainLoanId=%, chainId=%, borrower=%',
            p_on_chain_loan_id, v_chain_id, p_borrower_address;
    END IF;

    IF v_collateral_token_id IS NULL THEN
        RAISE EXCEPTION 'Loan % has no collateral token set', v_loan_id;
    END IF;

    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_collateral_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'withdrawal', 'confirmed',
        p_contract_address, p_borrower_address,
        COALESCE(v_collateral_amount, '0'), p_log_index, p_expired_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;

    -- Idempotent: only expire a still-pending loan.
    UPDATE public.loans
    SET status      = 'expired',
        "expiredAt" = p_expired_at
    WHERE id      = v_loan_id
      AND status  = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.expire_loan_with_transaction (
    text, address, uint256, address,
    text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.expire_loan_with_transaction (
    text, address, uint256, address,
    text, uint256, text, uint256, timestamptz
) TO service_role;
