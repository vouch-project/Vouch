<script lang="ts">
  /**
   * WalletButton — primary connect / account toggle button.
   *
   * - Disconnected: "Connect Wallet" → opens the AppKit connection modal.
   * - Connecting:   disabled spinner button while the modal is loading.
   * - Connected:    shows the truncated address → opens the Account view.
   *
   * Actions are deferred to the browser via dynamic import so that this
   * component remains fully SSR-safe.
   */
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import { LoaderCircle, Wallet } from '@lucide/svelte';

  const openConnectModal = async () => {
    const { getAppKit } = await import('$lib/wallet/appkit');
    getAppKit()?.open();
  };

  const openAccountModal = async () => {
    const { getAppKit } = await import('$lib/wallet/appkit');
    getAppKit()?.open({ view: 'Account' });
  };

  const handleClick = () => {
    if (wallet.isConnected) {
      openAccountModal();
    } else {
      openConnectModal();
    }
  };
</script>

<Button
  class={cn(
    'min-w-36 font-bold transition-all duration-200',
    wallet.isConnected && 'border-green-500/50 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10'
  )}
  disabled={wallet.isLoading}
  onclick={handleClick}
  size="default"
  variant={wallet.isConnected ? 'outline' : 'default'}
>
  {#if wallet.isLoading && !wallet.isConnected}
    <LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
    <span>Connecting…</span>
  {:else if wallet.isConnected}
    <div class="mr-2 h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
    <span>{wallet.shortAddress}</span>
  {:else}
    <Wallet class="mr-2 h-4 w-4" />
    <span>Connect Wallet</span>
  {/if}
</Button>
