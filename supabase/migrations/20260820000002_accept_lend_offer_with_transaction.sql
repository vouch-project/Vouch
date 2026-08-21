CREATE OR REPLACE FUNCTION accept_lend_offer_with_transaction (
    p_network_id text,
    p_contract_address address,
    p_on_chain_offer_id uint256,
    p_on_chain_loan_id uint256,
    p_borrower_address address,
    p_collateral_token_address address,
    p_collateral_amount text,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_accepted_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = '' AS $$
DECLARE
    v_chain_id uuid;
    v_offer_id uuid;
    v_principal_token_id uuid;
    v_collateral_token_id uuid;
    v_principal_amount text;
    v_lender_address public.address;
    v_interest_rate_bps integer;
    v_duration interval;
    v_loan_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    SELECT id, "principalTokenId", "principalAmount",
           "lenderAddress", "interestRateBps", duration
    INTO v_offer_id, v_principal_token_id, v_principal_amount,
         v_lender_address, v_interest_rate_bps, v_duration
    FROM public.lend_offers
    WHERE "onChainOfferId" = p_on_chain_offer_id AND "chainId" = v_chain_id;

    IF v_offer_id IS NULL THEN
        RAISE EXCEPTION 'Lend offer not found: onChainOfferId=%, chainId=%', p_on_chain_offer_id, v_chain_id;
    END IF;

    -- Look up the collateral token the borrower actually posted
    SELECT id INTO v_collateral_token_id
    FROM public.tokens
    WHERE "chainId" = v_chain_id AND address = p_collateral_token_address;

    IF v_collateral_token_id IS NULL THEN
        RAISE EXCEPTION 'Collateral token not found: %', p_collateral_token_address;
    END IF;

    -- Mark offer accepted
    UPDATE public.lend_offers
    SET status = 'accepted'
    WHERE id = v_offer_id;

    -- Create the loan row (already active/funded)
    INSERT INTO public.loans (
        "onChainLoanId", "chainId", "borrowerAddress", "lenderAddress",
        "principalTokenId", "collateralTokenId",
        "principalAmount", "collateralAmount",
        "interestRate", duration,
        status, "startAt", "fundedAt", "dueAt", "lendOfferId", "createdAt"
    ) VALUES (
        p_on_chain_loan_id, v_chain_id, p_borrower_address, v_lender_address,
        v_principal_token_id, v_collateral_token_id,
        v_principal_amount, p_collateral_amount,
        v_interest_rate_bps, v_duration,
        'active', p_accepted_at, p_accepted_at,
        CASE WHEN v_duration IS NOT NULL AND v_duration > interval '0'
             THEN p_accepted_at + v_duration
             ELSE NULL
        END,
        v_offer_id, p_accepted_at
    )
    ON CONFLICT ("chainId", "onChainLoanId") WHERE "onChainLoanId" IS NOT NULL DO NOTHING
    RETURNING id INTO v_loan_id;

    IF v_loan_id IS NULL THEN
        SELECT id INTO v_loan_id FROM public.loans
        WHERE "onChainLoanId" = p_on_chain_loan_id AND "chainId" = v_chain_id;
    END IF;

    -- Link offer -> loan
    UPDATE public.lend_offers SET "acceptedLoanId" = v_loan_id WHERE id = v_offer_id;

    -- collateral_deposit transaction
    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_collateral_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'collateral_deposit', 'confirmed',
        p_borrower_address, p_contract_address,
        p_collateral_amount, p_log_index, p_accepted_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;

    -- loan_disbursement transaction
    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_principal_token_id,
        p_tx_hash, p_block_number, p_block_hash,
        'loan_disbursement', 'confirmed',
        p_contract_address, p_borrower_address,
        v_principal_amount, p_log_index + 1, p_accepted_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION accept_lend_offer_with_transaction (
    text,
    address,
    uint256,
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
EXECUTE ON FUNCTION accept_lend_offer_with_transaction (
    text,
    address,
    uint256,
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
