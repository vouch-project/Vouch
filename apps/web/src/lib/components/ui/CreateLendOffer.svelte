<script lang="ts">
  import { postSignedOffer } from '$api/signedOrders';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import TokenAutocomplete from '$lib/components/ui/TokenAutocomplete.svelte';
  import { chainInfo } from '$lib/stores/chainInfo.svelte';
  import { tokenPrices } from '$lib/stores/tokenPrices.svelte';
  import { ensureVaultAllowance, generateNonce, signLendOffer, type SignedLendOffer } from '$lib/wallet/signedOrders';
  import { createLendOffer, getErc20Balance, isNativeTokenAddress } from '$lib/wallet/vouchVault';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { Loader2, Sparkles, Wallet } from '@lucide/svelte';
  import { ethers } from 'ethers';

  let principalSymbol = $state('MOCK');
  let principalAmount = $state('');
  let collateralRatioPct = $state('154');
  let trustedRatioPct = $state('125');
  let scoreThreshold = $state('750');
  let ratePct = $state('8.00');
  let durationDays = $state('30');
  let acceptWindowDays = $state('7');

  let submitting = $state(false);
  let status = $state<string | null>(null);
  let errorMsg = $state<string | null>(null);

  const tokens = $derived(chainInfo.tokens ?? []);
  const principalToken = $derived(tokens.find((t) => t.symbol === principalSymbol) ?? null);
  const principalIsErc20 = $derived(!!principalToken && !isNativeTokenAddress(principalToken.address ?? ''));

  const principalUsd = $derived(
    (parseFloat(principalAmount) || 0) * tokenPrices.getTokenMeta(principalSymbol).priceUsd,
  );
  const ethPriceUsd = $derived(tokenPrices.getTokenMeta('ETH').priceUsd);

  const RISK_LEVELS = {
    conservative: { collateralRatio: '200', trustedRatio: '154', threshold: '700', apr: '5.00', label: 'Conservative' },
    balanced: { collateralRatio: '154', trustedRatio: '125', threshold: '750', apr: '8.00', label: 'Balanced' },
    aggressive: { collateralRatio: '125', trustedRatio: '110', threshold: '800', apr: '12.00', label: 'Aggressive' },
  } as const;

  type RiskLevel = keyof typeof RISK_LEVELS;
  let selectedRisk = $state<RiskLevel | null>(null);
  const activeRisk = $derived(selectedRisk ?? 'balanced');

  const suggestedCollateralRatio = $derived(RISK_LEVELS[activeRisk].collateralRatio);
  const suggestedTrustedRatio = $derived(RISK_LEVELS[activeRisk].trustedRatio);
  const suggestedThreshold = $derived(RISK_LEVELS[activeRisk].threshold);
  const suggestedApr = $derived(RISK_LEVELS[activeRisk].apr);

  const maxLtvBps = $derived.by(() => {
    const baseRatioPctNum = parseFloat(collateralRatioPct || '0');
    const trustedRatioPctNum = parseFloat(trustedRatioPct || '0');
    const minRatioPctNum = trustedRatioPctNum > 0 ? Math.min(baseRatioPctNum, trustedRatioPctNum) : baseRatioPctNum;
    const minRatioBps = BigInt(Math.round(minRatioPctNum * 100));
    if (minRatioBps <= 0n) return 0;
    return Number((10000n * 10000n + minRatioBps - 1n) / minRatioBps);
  });

  const minCollateralEth = $derived.by(() => {
    const ratio = parseFloat(collateralRatioPct || '0');
    if (principalUsd <= 0 || ethPriceUsd <= 0 || ratio <= 0) return null;
    return (principalUsd * (ratio / 100)) / ethPriceUsd;
  });

  const trustedCollateralEth = $derived.by(() => {
    const ratio = parseFloat(trustedRatioPct || '0');
    if (principalUsd <= 0 || ethPriceUsd <= 0 || ratio <= 0) return null;
    return (principalUsd * (ratio / 100)) / ethPriceUsd;
  });

  const collateralRatioBps = $derived(Math.round(parseFloat(collateralRatioPct || '0') * 100));
  const trustedRatioBps = $derived(Math.round(parseFloat(trustedRatioPct || '0') * 100));
  const scoreThresholdNum = $derived(Math.round(parseFloat(scoreThreshold || '0')));
  const rateBps = $derived(Math.round(parseFloat(ratePct || '0') * 100));
  const grossRatePctNum = $derived(parseFloat(ratePct || '0'));
  const netAprPct = $derived(grossRatePctNum * (1 - chainInfo.protocolFeeBps / 10000));
  const feeAprPct = $derived(grossRatePctNum * (chainInfo.protocolFeeBps / 10000));

  const durationSeconds = $derived(Math.round(parseFloat(durationDays || '0') * 86400));
  const acceptWindowSeconds = $derived(Math.round(parseFloat(acceptWindowDays || '0') * 86400));

  const canSubmit = $derived(
    !!wallet.address &&
      !!principalToken &&
      parseFloat(principalAmount) > 0 &&
      collateralRatioBps >= 10000 &&
      (trustedRatioBps === 0 || (trustedRatioBps >= 10000 && trustedRatioBps <= collateralRatioBps)) &&
      maxLtvBps > 0 &&
      rateBps >= 0 &&
      rateBps <= 10000 &&
      durationSeconds > 0 &&
      acceptWindowSeconds > 0 &&
      !submitting,
  );

  const inputClass =
    'border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition w-full bg-background';
  const sectionClass = 'flex flex-col gap-3 p-4 rounded-lg border border-border/60 bg-muted/20';

  /** Map a wallet/API error to a user-facing message (distinguishes user-rejection & API 400). */
  const orderErrorMessage = (e: unknown, fallback: string): string => {
    if (e && typeof e === 'object') {
      const err = e as {
        code?: unknown;
        reason?: unknown;
        response?: { data?: { message?: unknown } };
        message?: unknown;
      };
      if (err.code === 'ACTION_REJECTED') return 'Signature rejected by user.';
      const apiMsg = err.response?.data?.message;
      if (typeof apiMsg === 'string') return apiMsg;
      if (Array.isArray(apiMsg)) return apiMsg.join(', ');
      if (typeof err.reason === 'string' && err.reason) return err.reason;
      if (typeof err.message === 'string') return err.message.replace(/^[\w-]+:\s*/, '') || fallback;
    }
    return fallback;
  };

  const handleSubmit = async () => {
    if (!principalToken) return;
    if (!wallet.address || wallet.networkId == null || !chainInfo.contractAddress) {
      errorMsg = 'Connect your wallet to create an offer.';
      return;
    }
    submitting = true;
    errorMsg = null;
    status = null;
    try {
      if (principalIsErc20) {
        // Gasless path: the lender signs an offer committing ERC20 principal; the borrower chooses
        // the collateral token + amount at fill time when calling fillLendOffer.
        const principalParsed = ethers.parseUnits(principalAmount, principalToken.decimals ?? 18);
        const balance = await getErc20Balance(principalToken.address, wallet.address!);
        if (balance < principalParsed) {
          const have = ethers.formatUnits(balance, principalToken.decimals ?? 18);
          throw new Error(`Insufficient ${principalSymbol} balance: you have ${have} but need ${principalAmount}.`);
        }
        const deadline = Math.floor(Date.now() / 1000) + acceptWindowSeconds;
        await ensureVaultAllowance(principalToken.address, principalParsed);
        status = 'Waiting for wallet signature…';
        const offer: SignedLendOffer = {
          lender: wallet.address!,
          principalToken: principalToken.address,
          principalAmount: principalParsed,
          collateralRatioBps,
          trustedRatioBps,
          scoreThreshold: scoreThresholdNum,
          maxLtvBps,
          interestRateBps: rateBps,
          durationSeconds: BigInt(durationSeconds),
          nonce: generateNonce(),
          deadline: BigInt(deadline),
        };
        const { signature } = await signLendOffer(offer);
        await postSignedOffer({
          lenderAddress: offer.lender,
          principalTokenAddress: principalToken.address,
          principalAmount: principalParsed.toString(),
          collateralRatioBps,
          trustedRatioBps,
          scoreThreshold: scoreThresholdNum,
          maxLtvBps,
          interestRateBps: rateBps,
          durationSeconds,
          nonce: offer.nonce.toString(),
          deadline,
          signature,
          networkId: String(wallet.networkId),
          contractAddress: chainInfo.contractAddress!,
        });
        status = 'Offer published!';
      } else {
        // On-chain path for ETH principal.
        await createLendOffer(
          principalToken,
          principalAmount,
          collateralRatioBps,
          trustedRatioBps,
          scoreThresholdNum,
          maxLtvBps,
          rateBps,
          durationSeconds,
          acceptWindowSeconds,
        );
        status = 'Offer created!';
      }
    } catch (e) {
      errorMsg = orderErrorMessage(e, 'Transaction failed');
    } finally {
      submitting = false;
    }
  };
</script>

<Card.Root class="bg-card/40 backdrop-blur-sm border-border/50 shadow-2xl shadow-primary/5">
  <Card.Header>
    <Card.Title class="text-2xl font-black tracking-tight flex items-center gap-2">
      <Wallet class="h-6 w-6 text-primary" />
      Create Lend Offer
    </Card.Title>
    <Card.Description class="text-muted-foreground">
      Lock your principal on-chain. A borrower posts collateral to accept.
    </Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <!-- Principal -->
    <div class={sectionClass}>
      <p class="text-sm font-semibold text-foreground">Principal</p>
      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground font-medium">Token</span>
          <TokenAutocomplete {tokens} bind:value={principalSymbol} />
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground font-medium">Amount</span>
          <input class={inputClass} inputmode="decimal" placeholder="0.0" type="text" bind:value={principalAmount} />
          <span class="text-xs text-muted-foreground min-h-4">
            {principalUsd > 0 ? `≈ $${principalUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : ''}
          </span>
        </div>
      </div>
    </div>

    <!-- Risk level -->
    <div class={sectionClass}>
      <p class="text-sm font-semibold text-foreground">Risk &amp; Terms</p>
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground font-medium shrink-0">Risk level:</span>
        {#each Object.entries(RISK_LEVELS) as [key, level] (key)}
          <button
            class="rounded-full border px-3 py-1 text-xs font-semibold transition-colors {activeRisk === key
              ? 'border-primary/40 bg-primary/15 text-primary'
              : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary'}"
            onclick={() => {
              selectedRisk = key as RiskLevel;
              collateralRatioPct = level.collateralRatio;
              trustedRatioPct = level.trustedRatio;
              scoreThreshold = level.threshold;
              ratePct = level.apr;
            }}
            type="button"
          >
            {level.label}
          </button>
        {/each}
      </div>

      <!-- Collateral ratios + score + APR in a 2x2 grid -->
      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1.5">
          <div class="flex items-baseline justify-between">
            <span class="text-xs text-muted-foreground font-medium">Base ratio (%)</span>
            <button
              class="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors {collateralRatioPct ===
              suggestedCollateralRatio
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary'}"
              onclick={() => (collateralRatioPct = suggestedCollateralRatio)}
              type="button"
            >
              <Sparkles class="h-3 w-3" />{suggestedCollateralRatio}%
            </button>
          </div>
          <div class="relative">
            <input
              class="{inputClass} pr-6"
              inputmode="decimal"
              min="100"
              placeholder="154"
              type="text"
              bind:value={collateralRatioPct}
            />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              %
            </span>
          </div>
          <span class="text-xs text-muted-foreground min-h-4">
            {minCollateralEth !== null ? `≈ ${minCollateralEth.toFixed(4)} ETH` : ''}
          </span>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-baseline justify-between">
            <span class="text-xs text-muted-foreground font-medium">Trusted ratio (%)</span>
            <button
              class="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors {trustedRatioPct ===
              suggestedTrustedRatio
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary'}"
              onclick={() => (trustedRatioPct = suggestedTrustedRatio)}
              type="button"
            >
              <Sparkles class="h-3 w-3" />{suggestedTrustedRatio}%
            </button>
          </div>
          <div class="relative">
            <input
              class="{inputClass} pr-6"
              inputmode="decimal"
              min="100"
              placeholder="125"
              type="text"
              bind:value={trustedRatioPct}
            />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              %
            </span>
          </div>
          <span class="text-xs text-muted-foreground min-h-4">
            {trustedCollateralEth !== null ? `≈ ${trustedCollateralEth.toFixed(4)} ETH` : ''}
          </span>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-baseline justify-between">
            <span class="text-xs text-muted-foreground font-medium">Min credit score</span>
            <button
              class="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors {scoreThreshold ===
              suggestedThreshold
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary'}"
              onclick={() => (scoreThreshold = suggestedThreshold)}
              type="button"
            >
              <Sparkles class="h-3 w-3" />{suggestedThreshold}
            </button>
          </div>
          <input
            class={inputClass}
            inputmode="numeric"
            max="1000"
            min="0"
            placeholder="750"
            type="text"
            bind:value={scoreThreshold}
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-baseline justify-between">
            <span class="text-xs text-muted-foreground font-medium">APR (%)</span>
            <button
              class="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors {ratePct ===
              suggestedApr
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary'}"
              onclick={() => (ratePct = suggestedApr)}
              type="button"
            >
              <Sparkles class="h-3 w-3" />{suggestedApr}%
            </button>
          </div>
          <div class="relative">
            <input
              class="{inputClass} pr-6"
              inputmode="decimal"
              max="100"
              min="0"
              placeholder="8"
              type="text"
              bind:value={ratePct}
            />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              %
            </span>
          </div>
          <span class="text-xs text-muted-foreground min-h-4">
            {#if grossRatePctNum > 0}
              {netAprPct.toFixed(2)}% earned · {feeAprPct.toFixed(2)}% fee
            {/if}
          </span>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground font-medium">Loan Duration</span>
          <div class="relative">
            <input
              class="{inputClass} pr-10"
              inputmode="decimal"
              min="1"
              placeholder="30"
              type="text"
              bind:value={durationDays}
            />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              days
            </span>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground font-medium">Accept Window</span>
          <div class="relative">
            <input
              class="{inputClass} pr-10"
              inputmode="decimal"
              min="1"
              placeholder="7"
              type="text"
              bind:value={acceptWindowDays}
            />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              days
            </span>
          </div>
        </div>
      </div>
    </div>

    {#if errorMsg}
      <p class="text-sm text-destructive">{errorMsg}</p>
    {/if}
    {#if status}
      <p class="text-sm text-green-600">{status}</p>
    {/if}
  </Card.Content>
  <Card.Footer class="flex flex-col gap-3">
    {#if !wallet.address}
      <p class="text-sm text-muted-foreground">Connect your wallet to create an offer.</p>
    {:else}
      <Button class="w-full font-bold" disabled={!canSubmit} onclick={handleSubmit} size="lg">
        {#if submitting}
          <Loader2 class="mr-2 h-4 w-4 animate-spin" />
          {principalIsErc20 ? 'Signing…' : 'Creating Offer…'}
        {:else}
          Create Lend Offer
        {/if}
      </Button>
    {/if}
  </Card.Footer>
</Card.Root>
