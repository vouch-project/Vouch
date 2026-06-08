-- ----------------------------------------------------------------------------
-- repay_loan_with_transaction(...)
-- Marks a loan as repaid, records the repayment transaction, and fans out
-- a notification to the borrower. Called by the blockchain listener upon
-- LoanRepaid events.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repay_loan_with_transaction (
    p_network_id          text,
    p_contract_address    address,
    p_on_chain_loan_id    uint256,
    p_borrower_address    address,
    p_lender_address      address,
    p_principal_amount    text,
    p_interest_amount     text,
    p_total_repaid        text,
    p_tx_hash             text,
    p_block_number        uint256,
    p_block_hash          text,
    p_log_index           uint256,
    p_repaid_at           timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
    v_chain_id            uuid;
    v_loan_id             uuid;
    v_principal_token_id  uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId"        = p_network_id
      AND "contractAddress"  = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: networkId=%, contractAddress=%',
            p_network_id, p_contract_address;
    END IF;

    UPDATE public.loans
    SET status     = 'repaid',
        "repaidAt" = p_repaid_at
    WHERE "onChainLoanId" = p_on_chain_loan_id
      AND "chainId"       = v_chain_id
      AND status         != 'repaid'           -- idempotent: skip if already repaid
    RETURNING id, "principalTokenId" INTO v_loan_id, v_principal_token_id;

    -- Already repaid (duplicate event) — exit cleanly.
    IF v_loan_id IS NULL THEN
        RETURN;
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
        p_borrower_address, p_lender_address,
        p_total_repaid, p_log_index, p_repaid_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;

    INSERT INTO public.notifications (
        "recipientAddress", type, title, body, "loanId", payload
    ) VALUES (
        p_borrower_address,
        'loan_repaid',
        'Loan fully repaid',
        'Your loan has been fully repaid and your collateral has been returned.',
        v_loan_id,
        jsonb_build_object(
            'principalAmount', p_principal_amount,
            'interestAmount',  p_interest_amount,
            'totalRepaid',     p_total_repaid,
            'txHash',          p_tx_hash
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.repay_loan_with_transaction (
    text, address, uint256, address, address,
    text, text, text, text, uint256, text, uint256, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.repay_loan_with_transaction (
    text, address, uint256, address, address,
    text, text, text, text, uint256, text, uint256, timestamptz
) TO service_role;
