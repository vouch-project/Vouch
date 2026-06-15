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
    v_final_payment       numeric;
BEGIN
    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId"        = p_network_id
      AND "contractAddress"  = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: networkId=%, contractAddress=%',
            p_network_id, p_contract_address;
    END IF;

    -- Ensure the loan row exists first. The listener's LoanCreated/LoanFunded
    -- handlers catch-and-log on failure without rethrowing, so a missed write
    -- could otherwise make a no-op UPDATE below indistinguishable from a
    -- duplicate event — silently dropping a valid repayment. Fail loudly instead.
    PERFORM 1
    FROM public.loans
    WHERE "onChainLoanId"   = p_on_chain_loan_id
      AND "chainId"         = v_chain_id
      AND "borrowerAddress" = p_borrower_address;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan not found: onChainLoanId=%, chainId=%, borrower=%',
            p_on_chain_loan_id, v_chain_id, p_borrower_address;
    END IF;

    UPDATE public.loans
    SET status          = 'repaid',
        "repaidAt"      = p_repaid_at,
        "lenderAddress" = COALESCE("lenderAddress", p_lender_address)  -- backfill if LoanFunded write was missed
    WHERE "onChainLoanId"   = p_on_chain_loan_id
      AND "chainId"         = v_chain_id
      AND "borrowerAddress" = p_borrower_address  -- guard against updating the wrong loan
      AND status           != 'repaid'           -- idempotent: skip if already repaid
    RETURNING id, "principalTokenId" INTO v_loan_id, v_principal_token_id;

    -- Loan exists but UPDATE matched nothing → already repaid (duplicate event). Exit cleanly.
    IF v_loan_id IS NULL THEN
        RETURN;
    END IF;

    IF v_principal_token_id IS NULL THEN
        RAISE EXCEPTION 'Loan % has no principal token set', v_loan_id;
    END IF;

    -- p_total_repaid is the cumulative debt repaid. Any prior LoanPartiallyRepaid
    -- events already inserted their payments, so record only the final delta here
    -- to avoid over-counting (sum of repayment transactions must equal totalDue).
    v_final_payment := GREATEST(
        p_total_repaid::numeric - COALESCE((
            SELECT SUM(t.amount::numeric)
            FROM public.transactions t
            WHERE t."loanId"  = v_loan_id
              AND t."chainId" = v_chain_id
              AND t.type      = 'repayment'
              AND t.status    = 'confirmed'
        ), 0),
        0
    );

    -- Skip when prior LoanPartiallyRepaid events already recorded the full debt
    -- (delta is 0): inserting would pollute repayment history with a no-op row.
    IF v_final_payment > 0 THEN
        INSERT INTO public.transactions (
            "loanId", "chainId", "tokenId", "txHash", "blockNumber", "blockHash",
            type, status, "fromAddress", "toAddress", amount, "logIndex", "txTimestamp"
        ) VALUES (
            v_loan_id, v_chain_id, v_principal_token_id,
            p_tx_hash, p_block_number, p_block_hash,
            'repayment', 'confirmed',
            p_borrower_address, p_lender_address,
            v_final_payment::text, p_log_index, p_repaid_at
        )
        ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;
    END IF;

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
