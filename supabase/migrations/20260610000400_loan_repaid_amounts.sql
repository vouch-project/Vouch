-- ----------------------------------------------------------------------------
-- Cache the cumulative on-chain repayment progress on the loans row so the UI
-- can render principal-returned / collateral-released without a live chain read.
--
-- These mirror the VouchVault loan struct fields `principalRepaid` and
-- `collateralReleased`. They are discrete, monotonic, event-driven values (they
-- only change on a repayment), so caching them is safe — unlike time-dependent
-- values (accrued interest, total due) which must always be read live.
--
-- Stored as `text` (raw base units) to match "principalAmount"/"collateralAmount"
-- and avoid the precision loss of numeric -> JS number in the generated types.
-- ----------------------------------------------------------------------------
-- principalRepaid was previously a uint256 (numeric) domain that was never
-- populated; switch it to text for consistency with the other amount columns.
ALTER TABLE loans
ALTER COLUMN "principalRepaid" TYPE text USING "principalRepaid"::text;

ALTER TABLE loans
ADD COLUMN IF NOT EXISTS "collateralReleased" text;

-- ----------------------------------------------------------------------------
-- record_partial_repayment(...) — now also caches the cumulative repaid amounts.
-- Signature changed (added p_principal_repaid / p_collateral_released), so the
-- old overload must be dropped to keep the RPC name unambiguous.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_partial_repayment (
    text,
    address,
    uint256,
    address,
    text,
    text,
    uint256,
    text,
    uint256,
    timestamptz
);

CREATE OR REPLACE FUNCTION public.record_partial_repayment (
    p_network_id text,
    p_contract_address address,
    p_on_chain_loan_id uint256,
    p_borrower_address address,
    p_payment_amount text,
    p_principal_repaid text,
    p_collateral_released text,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_paid_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = '' AS $$
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
    WHERE "onChainLoanId"   = p_on_chain_loan_id
      AND "chainId"         = v_chain_id
      AND "borrowerAddress" = p_borrower_address;  -- guard against wrong borrower/loan pairing

    IF v_loan_id IS NULL THEN
        RAISE EXCEPTION 'Loan not found: onChainLoanId=%, chainId=%',
            p_on_chain_loan_id, v_chain_id;
    END IF;

    IF v_principal_token_id IS NULL THEN
        RAISE EXCEPTION 'Loan % has no principal token set', v_loan_id;
    END IF;

    -- A partial-repayment event can be processed before the LoanFunded handler
    -- has written the lender. Raise rather than insert a row that violates
    -- transactions.toAddress NOT NULL. NOTE: the listener currently catches and
    -- logs this without replaying, so such an event is dropped — the per-chain
    -- event queue makes this ordering rare but does not guarantee durability.
    IF v_lender_address IS NULL THEN
        RAISE EXCEPTION 'Loan % has no lender set (loan not funded yet?)', v_loan_id;
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

    -- Cache the cumulative repaid amounts. GREATEST keeps the values monotonic so
    -- a late-arriving older event can never regress the cached progress.
    UPDATE public.loans
    SET "principalRepaid"    = GREATEST(COALESCE("principalRepaid"::numeric, 0), p_principal_repaid::numeric)::text,
        "collateralReleased" = GREATEST(COALESCE("collateralReleased"::numeric, 0), p_collateral_released::numeric)::text
    WHERE id = v_loan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_partial_repayment (
    text,
    address,
    uint256,
    address,
    text,
    text,
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
EXECUTE ON FUNCTION public.record_partial_repayment (
    text,
    address,
    uint256,
    address,
    text,
    text,
    text,
    text,
    uint256,
    text,
    uint256,
    timestamptz
) TO service_role;

-- ----------------------------------------------------------------------------
-- repay_loan_with_transaction(...) — now also caches the final repaid amounts.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.repay_loan_with_transaction (
    text,
    address,
    uint256,
    address,
    address,
    text,
    text,
    text,
    text,
    uint256,
    text,
    uint256,
    timestamptz
);

CREATE OR REPLACE FUNCTION public.repay_loan_with_transaction (
    p_network_id text,
    p_contract_address address,
    p_on_chain_loan_id uint256,
    p_borrower_address address,
    p_lender_address address,
    p_principal_amount text,
    p_interest_amount text,
    p_total_repaid text,
    p_principal_repaid text,
    p_collateral_released text,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_repaid_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = '' AS $$
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
    SET status               = 'repaid',
        "repaidAt"           = p_repaid_at,
        "lenderAddress"      = COALESCE("lenderAddress", p_lender_address),  -- backfill if LoanFunded write was missed
        "principalRepaid"    = GREATEST(COALESCE("principalRepaid"::numeric, 0), p_principal_repaid::numeric)::text,
        "collateralReleased" = GREATEST(COALESCE("collateralReleased"::numeric, 0), p_collateral_released::numeric)::text
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
    text,
    address,
    uint256,
    address,
    address,
    text,
    text,
    text,
    text,
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
EXECUTE ON FUNCTION public.repay_loan_with_transaction (
    text,
    address,
    uint256,
    address,
    address,
    text,
    text,
    text,
    text,
    text,
    text,
    uint256,
    text,
    uint256,
    timestamptz
) TO service_role;
