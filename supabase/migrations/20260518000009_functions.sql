-- Server-side RPC functions invoked via PostgREST. All functions run with
-- SECURITY DEFINER and an empty search_path; access is restricted to the
-- service_role (which the NestJS API uses with the secret key).
-- ----------------------------------------------------------------------------
-- ensure_user(address)
-- Idempotently creates the user profile row and stamps lastLoginAt.
-- Returned by the auth flow whenever a wallet logs in.
--
-- The address is stored verbatim — callers must already have normalized it
-- per chain-type (EIP-55 checksum-cased EVM, case-preserving Solana / Bitcoin / …).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_user (p_address address) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = '' AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO public.users (address, "lastLoginAt")
    VALUES (p_address, now())
    ON CONFLICT (address)
    DO UPDATE SET "lastLoginAt" = now()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user (address)
FROM
    PUBLIC;

GRANT
EXECUTE ON FUNCTION public.ensure_user (address) TO service_role;

-- ----------------------------------------------------------------------------
-- create_loan_with_transaction(...)
-- Records a new on-chain loan + its collateral deposit transaction atomically.
-- Called by the blockchain listener upon LoanCreated events.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_loan_with_transaction (
    p_network_id text,
    p_collateral_token_address address,
    p_contract_address address,
    p_on_chain_loan_id uint256,
    p_borrower_address address,
    p_collateral_amount text,
    p_requested_principal_token_address address,
    p_requested_principal_amount text,
    p_collateral_tx_hash text,
    p_collateral_block_number uint256,
    p_collateral_block_hash text,
    p_log_index uint256,
    p_collateral_locked_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = '' AS $$
DECLARE
    v_chain_id            uuid;
    v_collateral_token_id uuid;
    v_principal_token_id  uuid;
    v_loan_id             uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id
      AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    SELECT id INTO v_collateral_token_id
    FROM public.tokens
    WHERE address = p_collateral_token_address
      AND "chainId" = v_chain_id;

    IF v_collateral_token_id IS NULL THEN
        RAISE EXCEPTION 'Collateral token not found: % on chain %',
            p_collateral_token_address, p_network_id;
    END IF;

    SELECT id INTO v_principal_token_id
    FROM public.tokens
    WHERE address = p_requested_principal_token_address
      AND "chainId" = v_chain_id;

    IF v_principal_token_id IS NULL THEN
        RAISE EXCEPTION 'Principal token not found: % on chain %',
            p_requested_principal_token_address, p_network_id;
    END IF;

    INSERT INTO public.loans (
        "onChainLoanId", "borrowerAddress", "collateralAmount",
        "collateralTokenId", "principalTokenId", "principalAmount", "chainId"
    ) VALUES (
        p_on_chain_loan_id, p_borrower_address, p_collateral_amount,
        v_collateral_token_id, v_principal_token_id,
        p_requested_principal_amount, v_chain_id
    )
    ON CONFLICT ("chainId", "onChainLoanId") WHERE "onChainLoanId" IS NOT NULL
    DO UPDATE SET
        "borrowerAddress"   = EXCLUDED."borrowerAddress",
        "collateralAmount"  = EXCLUDED."collateralAmount",
        "collateralTokenId" = EXCLUDED."collateralTokenId",
        "principalTokenId"  = EXCLUDED."principalTokenId",
        "principalAmount"   = EXCLUDED."principalAmount"
    RETURNING id INTO v_loan_id;

    INSERT INTO public.transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_collateral_token_id, p_collateral_tx_hash,
        p_collateral_block_number, p_collateral_block_hash,
        'collateral_deposit', 'confirmed', p_borrower_address,
        p_contract_address, p_collateral_amount, p_log_index, p_collateral_locked_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;

    RETURN v_loan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_loan_with_transaction (
    text,
    address,
    address,
    uint256,
    address,
    text,
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
EXECUTE ON FUNCTION public.create_loan_with_transaction (
    text,
    address,
    address,
    uint256,
    address,
    text,
    address,
    text,
    text,
    uint256,
    text,
    uint256,
    timestamptz
) TO service_role;

-- ----------------------------------------------------------------------------
-- fund_loan_with_transaction(...)
-- Marks a loan as active and records the disbursement transaction.
-- Called by the blockchain listener upon LoanFunded events.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fund_loan_with_transaction (
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
    v_chain_id            uuid;
    v_loan_id             uuid;
    v_principal_token_id  uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id
      AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    UPDATE public.loans
    SET status          = 'active',
        "lenderAddress" = p_lender_address,
        "startAt"       = p_funded_at,
        "fundedAt"      = p_funded_at
    WHERE "onChainLoanId" = p_on_chain_loan_id
      AND "chainId"       = v_chain_id
    RETURNING id, "principalTokenId" INTO v_loan_id, v_principal_token_id;

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

REVOKE ALL ON FUNCTION public.fund_loan_with_transaction (
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
EXECUTE ON FUNCTION public.fund_loan_with_transaction (
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

-- ----------------------------------------------------------------------------
-- record_blockchain_event(...)
-- Idempotently stores a raw chain event in the dedup log. Returns true when
-- the event is new and should be processed, false if it was already seen.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_blockchain_event (
    p_network_id text,
    p_contract_address address,
    p_event_name text,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_args jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = '' AS $$
DECLARE
    v_chain_id    uuid;
    v_row_count   integer;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId" = p_network_id
      AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    INSERT INTO public.blockchain_event_log (
        "chainId", "eventName", "txHash", "blockNumber", "blockHash",
        "logIndex", "contractAddress", args
    ) VALUES (
        v_chain_id, p_event_name, p_tx_hash, p_block_number, p_block_hash,
        p_log_index, p_contract_address, p_args
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    RETURN v_row_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.record_blockchain_event (
    text,
    address,
    text,
    text,
    uint256,
    text,
    uint256,
    jsonb
)
FROM
    PUBLIC;

GRANT
EXECUTE ON FUNCTION public.record_blockchain_event (
    text,
    address,
    text,
    text,
    uint256,
    text,
    uint256,
    jsonb
) TO service_role;
