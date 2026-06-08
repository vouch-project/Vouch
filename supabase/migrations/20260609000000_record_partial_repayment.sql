-- ----------------------------------------------------------------------------
-- record_partial_repayment(...)
-- Records a partial repayment transaction without changing the loan status.
-- Lender address is resolved from the loans table (not in the event).
-- Called by the blockchain listener upon LoanPartiallyRepaid events.
-- Idempotent: duplicate (chainId, txHash, logIndex) tuples are silently ignored.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_partial_repayment (
    p_network_id          text,
    p_contract_address    address,
    p_on_chain_loan_id    uint256,
    p_borrower_address    address,
    p_payment_amount      text,
    p_tx_hash             text,
    p_block_number        uint256,
    p_block_hash          text,
    p_log_index           uint256,
    p_paid_at             timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
    v_chain_id            uuid;
    v_loan_id             uuid;
    v_principal_token_id  uuid;
    v_lender_address      public.address;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId"       = p_network_id
      AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: networkId=%, contractAddress=%',
            p_network_id, p_contract_address;
    END IF;

    SELECT id, "principalTokenId", "lenderAddress"
    INTO v_loan_id, v_principal_token_id, v_lender_address
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

    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_principal_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'repayment', 'confirmed',
        p_borrower_address, v_lender_address,
        p_payment_amount, p_log_index, p_paid_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.record_partial_repayment (
    text, address, uint256, address, text, text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_partial_repayment (
    text, address, uint256, address, text, text, uint256, text, uint256, timestamptz
) TO service_role;
