-- ----------------------------------------------------------------------------
-- cancel_loan_with_transaction(...)
-- Marks an unfunded/pending loan as cancelled, sets "cancelledAt", and records
-- the on-chain collateral return as a `withdrawal` transaction. Called by the
-- blockchain listener upon LoanCancelled events. The `withdrawal` type is used
-- because cancellation returns the locked collateral from the contract back to
-- the borrower (the reverse direction of the collateral_deposit on creation);
-- the transactionType enum has no dedicated cancellation value.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_loan_with_transaction (
    p_network_id          text,
    p_contract_address    address,
    p_on_chain_loan_id    uint256,
    p_borrower_address    address,
    p_tx_hash             text,
    p_block_number        uint256,
    p_block_hash          text,
    p_log_index           uint256,
    p_cancelled_at        timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
    v_chain_id             uuid;
    v_loan_id              uuid;
    v_collateral_token_id  uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId"        = p_network_id
      AND "contractAddress"  = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: networkId=%, contractAddress=%',
            p_network_id, p_contract_address;
    END IF;

    -- Resolve the loan and its collateral token. transactions."tokenId" is
    -- NOT NULL, so the cancellation transaction is attributed to the returned
    -- collateral token. Fail loudly if the loan row is missing so a missed
    -- LoanCreated write isn't silently swallowed by a no-op UPDATE below.
    SELECT id, "collateralTokenId"
    INTO v_loan_id, v_collateral_token_id
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

    -- Record the collateral return (contract -> borrower) as a withdrawal.
    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_collateral_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'withdrawal', 'confirmed',
        p_contract_address, p_borrower_address,
        '0', p_log_index, p_cancelled_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;

    -- Idempotent: only cancel a still-pending loan. A no-op here (already
    -- cancelled, or funded/active) is treated as a duplicate event.
    UPDATE public.loans
    SET status        = 'cancelled',
        "cancelledAt" = p_cancelled_at
    WHERE id      = v_loan_id
      AND status  = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_loan_with_transaction (
    text, address, uint256, address,
    text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cancel_loan_with_transaction (
    text, address, uint256, address,
    text, uint256, text, uint256, timestamptz
) TO service_role;
