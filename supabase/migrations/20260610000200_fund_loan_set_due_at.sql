CREATE OR REPLACE FUNCTION fund_loan_with_transaction (
    p_network_id text,
    p_contract_address address,
    p_on_chain_loan_id uint256,
    p_lender_address address,
    p_borrower_address address,
    p_principal_amount text,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_funded_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = '' AS $$
DECLARE
    v_chain_id uuid;
    v_loan_id uuid;
    v_principal_token_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    UPDATE public.loans
    SET
        status = 'active',
        "lenderAddress" = p_lender_address,
        "startAt" = p_funded_at,
        "fundedAt" = p_funded_at,
        "dueAt" = CASE
                    WHEN duration IS NOT NULL AND duration > interval '0'
                    THEN p_funded_at + duration
                    ELSE NULL
                  END,
        "updatedAt" = now()
    WHERE "onChainLoanId" = p_on_chain_loan_id AND "chainId" = v_chain_id
    RETURNING id, "principalTokenId" INTO v_loan_id, v_principal_token_id;

    IF v_loan_id IS NULL THEN
        RAISE EXCEPTION 'Loan not found: onChainLoanId=%, chainId=%', p_on_chain_loan_id, v_chain_id;
    END IF;

    IF v_principal_token_id IS NULL THEN
        RAISE EXCEPTION 'Loan % has no principal token set', v_loan_id;
    END IF;

    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_principal_token_id, p_tx_hash, p_block_number,
        p_block_hash, 'loan_disbursement', 'confirmed', p_lender_address,
        p_borrower_address, p_principal_amount, p_log_index, p_funded_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;

    -- Notify the borrower in their inbox.
    INSERT INTO public.notifications (
        "recipientAddress", type, title, body, "loanId", payload
    ) VALUES (
        p_borrower_address,
        'loan_funded',
        'Your loan was funded',
        'A lender funded your loan request.',
        v_loan_id,
        jsonb_build_object(
            'lenderAddress', p_lender_address,
            'principalAmount', p_principal_amount,
            'txHash', p_tx_hash
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION fund_loan_with_transaction (
    text,
    address,
    uint256,
    address,
    address,
    text,
    text,
    uint256,
    text,
    uint256,
    timestamptz
)
FROM
    PUBLIC;

GRANT
EXECUTE ON FUNCTION fund_loan_with_transaction (
    text,
    address,
    uint256,
    address,
    address,
    text,
    text,
    uint256,
    text,
    uint256,
    timestamptz
) TO service_role;
