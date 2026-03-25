CREATE OR REPLACE FUNCTION create_loan_with_transaction (
    p_network_id text,
    p_collateral_token_address text,
    p_contract_address text,
    p_on_chain_loan_id text,
    p_borrower_address text,
    p_collateral_amount numeric,
    p_collateral_tx_hash text,
    p_collateral_block_number bigint,
    p_collateral_block_hash text,
    p_log_index integer,
    p_collateral_locked_at timestamptz
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_chain_id uuid;
    v_token_id uuid;
    v_loan_id uuid;
BEGIN
    SELECT id INTO v_chain_id
    FROM chains WHERE "networkId" = p_network_id AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: %', p_network_id;
    END IF;

    SELECT id INTO v_token_id
    FROM tokens
    WHERE address = p_collateral_token_address AND "chainId" = v_chain_id;

    IF v_token_id IS NULL THEN
        RAISE EXCEPTION 'Collateral token not found: % on chain %', p_collateral_token_address, p_network_id;
    END IF;

    INSERT INTO loans (
        "onChainLoanId", "borrowerAddress", "collateralAmount",
        "collateralTokenId", "chainId"
    ) VALUES (
        p_on_chain_loan_id, p_borrower_address, p_collateral_amount,
        v_token_id, v_chain_id
    ) RETURNING id INTO v_loan_id;

    INSERT INTO transactions (
        "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
        type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
    ) VALUES (
        v_loan_id, v_chain_id, v_token_id, p_collateral_tx_hash, p_collateral_block_number,
        p_collateral_block_hash, 'collateral_deposit', 'confirmed', p_borrower_address,
        p_contract_address, p_collateral_amount, p_log_index, p_collateral_locked_at
    );

    RETURN v_loan_id;
END;
$$;
