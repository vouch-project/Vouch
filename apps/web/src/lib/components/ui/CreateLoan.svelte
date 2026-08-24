<script lang="ts">
  import { axiosApi } from '$api/axiosApi';
  import type { Token } from '$api/chain';
  import { postSignedRequest } from '$api/signedOrders';
  import { DEPLOYMENT_ENV } from '$lib/env';
  import { fetchLtvAttestation } from '$lib/loans/creditScore';
  import { calculateHealthFactor } from '$lib/loans/loanMath';
  import { maxLtv } from '$lib/ltv';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { tokenPrices } from '$lib/stores/tokenPrices.svelte';
  import {
    ensureVaultAllowance,
    generateNonce,
    signLoanRequest,
    type SignedLoanRequest,
  } from '$lib/wallet/signedOrders';
  import { createLoan, isNativeTokenAddress } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { ethers } from 'ethers';
  import CollateralBorrowFields from '../create-loan/CollateralBorrowFields.svelte';
  import LoanTermsFields from '../create-loan/LoanTermsFields.svelte';
  import LtvIndicator from '../create-loan/LtvIndicator.svelte';
  import RepaymentSummary from '../create-loan/RepaymentSummary.svelte';

  // ── Form state ────────────────────────────────────────────────────────────
  let collateralAmount = $state('1.0');
  let borrowAmount = $state('');
  let status = $state('');
  let selectedCollateralToken = $state('ETH');
  let selectedBorrowToken = $state(DEPLOYMENT_ENV === 'local' ? 'MOCK' : 'USDC');

  let interestRatePct = $state('5');
  let durationDays = $state('30');
  let fundWindowDays = $state('7');

  // Credit score (fetched once when address is known)
  let creditScore = $state<number | null>(null);

  $effect(() => {
    if (!wallet.address) {
      creditScore = null;
      return;
    }
    axiosApi
      .get<{ score: number }>(`/scoring/${wallet.address}`)
      .then(({ data }) => {
        creditScore = data.score;
      })
      .catch(() => {
        creditScore = null;
      });
  });

  // ── LTV Calculations ──────────────────────────────────────────────────────
  const collateralMeta = $derived(tokenPrices.getTokenMeta(selectedCollateralToken));
  const borrowMeta = $derived(tokenPrices.getTokenMeta(selectedBorrowToken));
  const computedMaxLtv = $derived(maxLtv(collateralMeta, borrowMeta, creditScore));
  const collateralUsd = $derived((parseFloat(collateralAmount) || 0) * collateralMeta.priceUsd);
  const borrowUsd = $derived((parseFloat(borrowAmount) || 0) * borrowMeta.priceUsd);
  const currentLtv = $derived(collateralUsd > 0 ? (borrowUsd / collateralUsd) * 100 : 0);
  const ltvExceeded = $derived(currentLtv > computedMaxLtv);
  const projectedHf = $derived(calculateHealthFactor(collateralUsd, borrowUsd, computedMaxLtv));

  // ── Recommended APR (credit score + LTV risk) ────────────────────────────
  // Score sets the ceiling (300→15%, 850→5%). LTV utilization scales it down:
  // borrowing 10% of max LTV → 10% of that ceiling. No borrow entered → null.
  const recommendedApr = $derived.by(() => {
    if (creditScore === null || currentLtv <= 0 || computedMaxLtv <= 0) return null;
    const scoreNorm = Math.max(0, Math.min(1, (creditScore - 300) / 550));
    const ceiling = 5 + (1 - scoreNorm) * 10;
    const ltvRatio = Math.min(1, currentLtv / computedMaxLtv);
    return ceiling * ltvRatio;
  });

  // ── Repayment ─────────────────────────────────────────────────────────────
  const totalRepayment = $derived.by(() => {
    const principal = parseFloat(borrowAmount) || 0;
    const rate = parseFloat(interestRatePct) || 0;
    const days = parseInt(durationDays) || 0;
    if (principal <= 0 || days <= 0) return null;
    const interest = principal * (rate / 100) * (days / 365);
    return { total: principal + interest, interest };
  });

  // ── Validation ──────────────────────────────────────────────────────────────
  type ParsedTerms = {
    collateralToken: Token;
    borrowToken: Token;
    interestRateBps: number;
    durationSeconds: number;
    fundWindowSeconds: number;
    liquidationThresholdBps: number;
  };

  /** Validate the form and parse the shared loan terms; sets `status` and returns null on failure. */
  const parseTerms = (): ParsedTerms | null => {
    const collateralValue = Number(collateralAmount);
    if (!collateralAmount.trim() || !isFinite(collateralValue) || collateralValue <= 0) {
      status = 'Enter a valid collateral amount greater than 0.';
      return null;
    }

    const borrowValue = Number(borrowAmount);
    if (!borrowAmount.trim() || !isFinite(borrowValue) || borrowValue <= 0) {
      status = 'Enter a valid borrow amount greater than 0.';
      return null;
    }

    if (ltvExceeded) {
      status = 'Borrow amount exceeds the maximum LTV. Reduce the amount or add more collateral.';
      return null;
    }

    const ratePct = Number(interestRatePct);
    if (!isFinite(ratePct) || ratePct < 0) {
      status = 'Enter a valid interest rate of 0% APR or higher.';
      return null;
    }
    if (ratePct > 100) {
      status = 'Interest rate cannot exceed 100% APR.';
      return null;
    }
    const durDays = Number(durationDays);
    if (!Number.isInteger(durDays) || durDays <= 0) {
      status = 'Loan duration must be a positive whole number of days.';
      return null;
    }
    const windowDays = Number(fundWindowDays);
    if (!Number.isInteger(windowDays) || windowDays <= 0) {
      status = 'Funding window must be a positive whole number of days.';
      return null;
    }
    const interestRateBps = Math.round(ratePct * 100);
    const durationSeconds = durDays * 86400;
    if (!Number.isSafeInteger(durationSeconds)) {
      status = 'Loan duration is too large.';
      return null;
    }
    const fundWindowSeconds = windowDays * 86400;
    if (!Number.isSafeInteger(fundWindowSeconds)) {
      status = 'Funding window is too large.';
      return null;
    }

    const collateralToken = chainInfo.tokens.find((t) => t.symbol === selectedCollateralToken);
    if (!collateralToken) {
      status = 'Collateral token not found';
      return null;
    }

    const borrowToken = chainInfo.tokens.find((t) => t.symbol === selectedBorrowToken);
    if (!borrowToken) {
      status = 'Borrow token not found';
      return null;
    }

    const liquidationThresholdBps = Math.max(1, Math.min(10000, Math.round(computedMaxLtv * 100)));
    return {
      collateralToken,
      borrowToken,
      interestRateBps,
      durationSeconds,
      fundWindowSeconds,
      liquidationThresholdBps,
    };
  };

  /** Map a wallet/API error to a user-facing message (distinguishes user-rejection & API 400). */
  const orderErrorMessage = (e: unknown, fallback: string): string => {
    if (e && typeof e === 'object') {
      const err = e as {
        code?: unknown;
        info?: { error?: { message?: string } };
        response?: { data?: { message?: unknown } };
        message?: unknown;
      };
      if (err.code === 'ACTION_REJECTED') return 'Signature rejected by user.';
      const apiMsg = err.response?.data?.message;
      if (typeof apiMsg === 'string') return apiMsg;
      if (Array.isArray(apiMsg)) return apiMsg.join(', ');
      if (err.info?.error?.message) return err.info.error.message;
      if (typeof err.message === 'string') return err.message.replace(/^[\w-]+:\s*/, '') || fallback;
    }
    return fallback;
  };

  const collateralIsErc20 = $derived(
    !isNativeTokenAddress(chainInfo.tokens.find((t) => t.symbol === selectedCollateralToken)?.address ?? ''),
  );

  // ── Submit ────────────────────────────────────────────────────────────────
  // Gasless path when collateral is ERC-20 (sign off-chain, lender fills later);
  // on-chain path for ETH collateral.
  const handleCreateLoan = async (e: SubmitEvent) => {
    e.preventDefault();
    const terms = parseTerms();
    if (!terms) return;

    if (collateralIsErc20) {
      if (!wallet.address || wallet.networkId == null || !chainInfo.contractAddress) {
        status = 'Connect your wallet to create a loan request.';
        return;
      }
      status = 'Waiting for wallet signature...';
      try {
        const collateralParsed = ethers.parseUnits(collateralAmount, terms.collateralToken.decimals ?? 18);
        const principalParsed = ethers.parseUnits(borrowAmount, terms.borrowToken.decimals ?? 18);
        const principalTokenAddress = isNativeTokenAddress(terms.borrowToken.address)
          ? ethers.ZeroAddress
          : terms.borrowToken.address;
        const nonce = generateNonce();
        const deadline = Math.floor(Date.now() / 1000) + terms.fundWindowSeconds;
        const req: SignedLoanRequest = {
          borrower: wallet.address,
          collateralToken: terms.collateralToken.address,
          collateralAmount: collateralParsed,
          principalToken: principalTokenAddress,
          principalAmount: principalParsed,
          interestRateBps: terms.interestRateBps,
          durationSeconds: BigInt(terms.durationSeconds),
          maxLtvBps: terms.liquidationThresholdBps,
          nonce,
          deadline: BigInt(deadline),
        };
        await ensureVaultAllowance(terms.collateralToken.address, collateralParsed);
        const { signature } = await signLoanRequest(req);
        await postSignedRequest({
          borrowerAddress: req.borrower,
          collateralTokenAddress: req.collateralToken,
          collateralAmount: collateralParsed.toString(),
          principalTokenAddress,
          principalAmount: principalParsed.toString(),
          interestRateBps: terms.interestRateBps,
          durationSeconds: terms.durationSeconds,
          maxLtvBps: terms.liquidationThresholdBps,
          nonce: nonce.toString(),
          deadline,
          signature,
          networkId: String(wallet.networkId),
          contractAddress: chainInfo.contractAddress,
        });
        status = 'Loan request published!';
      } catch (err) {
        status = orderErrorMessage(err, 'Failed to publish loan request.');
      }
    } else {
      if (!wallet.address || wallet.networkId == null || !chainInfo.contractAddress) {
        status = 'Connect your wallet to create a loan request.';
        return;
      }
      status = 'Fetching LTV attestation...';
      try {
        const attestation = await fetchLtvAttestation(
          wallet.address,
          terms.collateralToken.address,
          terms.borrowToken.address,
          chainInfo.contractAddress,
          BigInt(wallet.networkId),
        );
        status = 'Waiting for wallet confirmation...';
        await createLoan(
          collateralAmount,
          terms.collateralToken,
          terms.borrowToken,
          borrowAmount,
          terms.interestRateBps,
          terms.durationSeconds,
          terms.fundWindowSeconds,
          terms.liquidationThresholdBps,
          attestation,
        );
        status = 'Loan created!';
      } catch (err) {
        status = orderErrorMessage(err, 'Transaction failed');
      }
    }
  };

  const isSubmitting = $derived(
    status === 'Waiting for wallet confirmation...' ||
      status === 'Waiting for wallet signature...' ||
      status === 'Fetching LTV attestation...',
  );
  const statusIsSuccess = $derived(status === 'Loan created!' || status === 'Loan request published!');

  const inputClass =
    'border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition w-full bg-background';
  const sectionClass = 'flex flex-col gap-3 p-4 rounded-lg border border-border/60 bg-muted/20';
</script>

<form class="flex flex-col gap-5 w-full" onsubmit={handleCreateLoan}>
  <CollateralBorrowFields
    {inputClass}
    {sectionClass}
    bind:collateralAmount
    bind:borrowAmount
    bind:selectedCollateralToken
    bind:selectedBorrowToken
  />

  <LoanTermsFields
    {inputClass}
    {recommendedApr}
    {sectionClass}
    bind:interestRatePct
    bind:durationDays
    bind:fundWindowDays
  />

  <LtvIndicator {computedMaxLtv} {creditScore} {currentLtv} {ltvExceeded} {projectedHf} />

  <RepaymentSummary
    empty={totalRepayment === null}
    interest={totalRepayment?.interest ?? 0}
    tokenSymbol={selectedBorrowToken}
    total={totalRepayment?.total ?? 0}
  />

  <button
    class="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 py-2.5 rounded-lg shadow transition disabled:opacity-60 disabled:cursor-not-allowed {ltvExceeded
      ? '!bg-destructive hover:!bg-destructive/90'
      : ''}"
    disabled={isSubmitting || ltvExceeded}
    type="submit"
  >
    {isSubmitting ? 'Processing...' : ltvExceeded ? 'LTV Exceeded' : 'Create Loan'}
  </button>

  {#if status}
    <p
      class="text-sm {statusIsSuccess
        ? 'text-green-600'
        : ltvExceeded || status.includes('exceeds')
          ? 'text-destructive'
          : 'text-muted-foreground'} text-center"
    >
      {status}
    </p>
  {/if}
</form>
