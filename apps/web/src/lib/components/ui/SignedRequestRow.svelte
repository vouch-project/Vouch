<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Table from '$lib/components/ui/table';
  import { formatUint256 } from '$lib/formatUint256';
  import { formatLoanTerm, intervalToSeconds } from '$lib/loans/loanMath';
  import type { SignedRequestDashRow } from '$lib/types';
  import { parseContractError } from '$lib/wallet/contractError';
  import { cancelSignedLoanRequest, type SignedLoanRequest } from '$lib/wallet/signedOrders';
  import { Zap } from '@lucide/svelte';
  import { ethers } from 'ethers';

  type Props = {
    req: SignedRequestDashRow;
    onCancelled?: () => void;
  };

  let { req, onCancelled }: Props = $props();

  let cancelling = $state(false);
  let cancelError = $state('');

  const canCancel = $derived(req.status === 'open' || req.status === 'stale');

  const statusVariant = (status: string): 'default' | 'secondary' | 'outline' => {
    if (status === 'open') return 'default';
    if (status === 'filled') return 'secondary';
    return 'outline';
  };

  const handleCancel = async () => {
    cancelling = true;
    cancelError = '';
    try {
      const reqStruct: SignedLoanRequest = {
        borrower: req.borrowerAddress,
        collateralToken: req.collateralToken?.address ?? ethers.ZeroAddress,
        collateralAmount: BigInt(req.collateralAmount),
        principalToken: req.principalToken?.address ?? ethers.ZeroAddress,
        principalAmount: BigInt(req.principalAmount),
        interestRateBps: req.interestRateBps,
        durationSeconds: BigInt(intervalToSeconds(req.duration)),
        maxLtvBps: req.maxLtvBps,
        nonce: BigInt(req.nonce),
        deadline: BigInt(Math.floor(Date.parse(req.deadline) / 1000)),
      };
      await cancelSignedLoanRequest(reqStruct);
      onCancelled?.();
    } catch (e) {
      cancelError = parseContractError(e, 'Cancel failed.');
    } finally {
      cancelling = false;
    }
  };
</script>

<Table.Row class="hover:bg-muted/10 transition-colors opacity-90">
  <!-- Loan # — signed requests have no on-chain ID yet -->
  <Table.Cell class="pl-4 sm:pl-6 py-3 font-bold whitespace-nowrap">
    <div class="flex items-center gap-1.5">
      <Zap class="h-3.5 w-3.5 text-amber-500 shrink-0" />
      <span class="text-muted-foreground font-medium text-sm">Request</span>
    </div>
    <div class="text-[10px] font-normal text-muted-foreground mt-0.5">
      Expires {new Date(req.deadline).toLocaleDateString()}
    </div>
  </Table.Cell>

  <!-- Principal -->
  <Table.Cell class="px-2 sm:px-4 py-3 text-center whitespace-nowrap text-sm">
    {formatUint256(req.principalAmount, req.principalToken?.decimals ?? 18)}
    <span class="text-muted-foreground text-xs">{req.principalToken?.symbol ?? ''}</span>
  </Table.Cell>

  <!-- Collateral -->
  <Table.Cell class="px-2 sm:px-4 py-3 text-center whitespace-nowrap text-sm">
    {formatUint256(req.collateralAmount, req.collateralToken?.decimals ?? 18)}
    <span class="text-muted-foreground text-xs">{req.collateralToken?.symbol ?? ''}</span>
  </Table.Cell>

  <!-- Interest -->
  <Table.Cell class="px-2 sm:px-4 py-3 text-center whitespace-nowrap text-sm">
    <span class="font-medium">{(req.interestRateBps / 100).toFixed(2)}% APR</span>
    <div class="text-xs text-muted-foreground">{formatLoanTerm(req.duration)} term</div>
  </Table.Cell>

  <!-- Repaid so far — n/a for unsigned requests -->
  <Table.Cell class="px-2 sm:px-4 py-3 text-center text-muted-foreground text-sm">—</Table.Cell>

  <!-- Due date — show deadline for the signed request -->
  <Table.Cell class="px-2 sm:px-4 py-3 text-center whitespace-nowrap text-sm text-muted-foreground">
    Deadline {new Date(req.deadline).toLocaleDateString()}
  </Table.Cell>

  <!-- Health Factor — n/a -->
  <Table.Cell class="px-2 sm:px-4 py-3 text-center text-muted-foreground text-sm">—</Table.Cell>

  <!-- Status -->
  <Table.Cell class="px-2 sm:px-4 py-3 whitespace-nowrap text-center">
    <Badge class="capitalize" variant={statusVariant(req.status)}>{req.status}</Badge>
  </Table.Cell>

  <!-- Action -->
  <Table.Cell class="pr-4 sm:pr-6 py-3 text-right whitespace-nowrap">
    {#if canCancel}
      <Button
        class="font-bold h-8 px-3 text-xs"
        disabled={cancelling}
        onclick={handleCancel}
        size="sm"
        variant="destructive"
      >
        {cancelling ? 'Cancelling…' : 'Cancel'}
      </Button>
      {#if cancelError}
        <p class="text-[10px] text-destructive mt-1">{cancelError}</p>
      {/if}
    {/if}
  </Table.Cell>
</Table.Row>
