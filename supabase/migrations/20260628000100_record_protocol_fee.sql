-- ----------------------------------------------------------------------------
-- 1) record_protocol_fee(...) — records the on-chain protocol fee as its own
--    ledger entry (type = 'protocol_fee', from borrower -> protocolTreasury).
--
--    The VouchVault contract diverts `interest * protocolFeeBps / 10000` from the
--    interest portion of every repayment to `protocolTreasury` and emits a
--    dedicated `ProtocolFeeCollected(loanId, token, amount)` event. The repayment
--    RPCs keep recording the GROSS debt payment to the lender (so the existing
--    `totalRepaid` reconciliation and borrower progress stay correct); this
--    function records the fee separately so lender net receipts and treasury
--    income are both derivable from the ledger. It is keyed by the fee event's own
--    (chainId, txHash, logIndex), so it is idempotent and independent of the
--    repayment row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_protocol_fee (
    p_network_id text,
    p_contract_address address,
    p_on_chain_loan_id uint256,
    p_treasury_address address,
    p_fee_amount text,
    p_tx_hash text,
    p_block_number uint256,
    p_block_hash text,
    p_log_index uint256,
    p_collected_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = '' AS $$
DECLARE
    v_chain_id            uuid;
    v_loan_id             uuid;
    v_principal_token_id  uuid;
    v_borrower_address    public.address;
BEGIN
    -- Skip no-op fees (treasury unset or fee == 0): the contract emits these only
    -- when a fee is actually collected, but guard defensively.
    IF p_fee_amount IS NULL OR p_fee_amount::numeric <= 0 THEN
        RETURN;
    END IF;

    SELECT id INTO v_chain_id
    FROM public.chains
    WHERE "networkId"       = p_network_id
      AND "contractAddress" = p_contract_address;

    IF v_chain_id IS NULL THEN
        RAISE EXCEPTION 'Chain not found: networkId=%, contractAddress=%',
            p_network_id, p_contract_address;
    END IF;

    -- ProtocolFeeCollected carries only (loanId, token, amount), so resolve the
    -- loan by on-chain id + chain and read the borrower from the cached row.
    SELECT id, "principalTokenId", "borrowerAddress"
    INTO v_loan_id, v_principal_token_id, v_borrower_address
    FROM public.loans
    WHERE "onChainLoanId" = p_on_chain_loan_id
      AND "chainId"       = v_chain_id;

    -- The fee event may be processed before the loan row exists. Raise so the
    -- listener logs and the event isn't silently dropped (consistent with the
    -- repayment handlers).
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
        'protocol_fee', 'confirmed',
        v_borrower_address, p_treasury_address,
        p_fee_amount, p_log_index, p_collected_at
    )
    ON CONFLICT ("chainId", "txHash", "logIndex") DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.record_protocol_fee (
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
)
FROM
    PUBLIC;

GRANT
EXECUTE ON FUNCTION public.record_protocol_fee (
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
) TO service_role;

-- ----------------------------------------------------------------------------
-- 2) repay_loan_with_transaction(...) — self-heal terminal repaid amounts.
--
--    `LoanRepaid` is terminal: a fully repaid loan has `principalRepaid` equal to
--    the full principal and `collateralReleased` equal to the full collateral. The
--    listener reads these from chain and can fall back to 0 on a read failure;
--    GREATEST(NULL -> 0) would then permanently cache 0 with no later event to
--    reconcile. Clamp against the loan's own full amounts so the cached progress is
--    always correct once the loan is marked repaid, regardless of the chain read.
--
--    Signature is unchanged from 20260610000400, so CREATE OR REPLACE is enough.
-- ----------------------------------------------------------------------------
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

    -- A fully repaid loan has returned all principal and released all collateral,
    -- so clamp the cached progress up to the loan's own full amounts. This makes
    -- the terminal values correct even if the listener's live chain read failed
    -- and passed 0 (GREATEST keeps everything monotonic).
    UPDATE public.loans
    SET status               = 'repaid',
        "repaidAt"           = p_repaid_at,
        "lenderAddress"      = COALESCE("lenderAddress", p_lender_address),  -- backfill if LoanFunded write was missed
        "principalRepaid"    = GREATEST(COALESCE("principalRepaid"::numeric, 0), p_principal_repaid::numeric, "principalAmount"::numeric)::text,
        "collateralReleased" = GREATEST(COALESCE("collateralReleased"::numeric, 0), p_collateral_released::numeric, "collateralAmount"::numeric)::text
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
    -- Only 'repayment' rows count toward the gross debt; 'protocol_fee' rows are a
    -- separate ledger entry and are excluded.
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
