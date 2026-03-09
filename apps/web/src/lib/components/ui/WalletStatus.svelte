<script lang="ts">
  /**
   * WalletStatus — detailed panel shown when a wallet is connected.
   *
   * Displays the current address (click to copy) and the active network.
   * Provides a disconnect action.
   */
  import { networkName, shortAddress, walletAddress, walletIsConnected } from '$lib/wallet/store';

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout>;

  function copyAddress() {
    if (!$walletAddress) return;
    navigator.clipboard.writeText($walletAddress).then(() => {
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1500);
    });
  }

  async function disconnect() {
    const { getAppKit } = await import('$lib/wallet/appkit');
    await getAppKit()?.disconnect();
  }
</script>

{#if $walletIsConnected}
  <div class="wallet-status" role="region" aria-label="Connected wallet">
    <div class="row">
      <span class="label">Address</span>
      <button
        class="address-btn"
        onclick={copyAddress}
        title={copied ? 'Copied!' : 'Click to copy address'}
        aria-label={copied ? 'Address copied' : 'Copy wallet address'}
      >
        <span class="monospace">{$shortAddress}</span>
        <span class="copy-icon" aria-hidden="true">{copied ? '✓' : '⧉'}</span>
      </button>
    </div>

    {#if $networkName}
      <div class="row">
        <span class="label">Network</span>
        <span class="network-badge">{$networkName}</span>
      </div>
    {/if}

    <button class="disconnect-btn" onclick={disconnect}> Disconnect </button>
  </div>
{/if}

<style>
  .wallet-status {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    padding: 1.125rem;
    border: 1px solid #e5e7eb;
    border-radius: 0.875rem;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.06);
    min-width: 220px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #6b7280;
  }

  .address-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.375rem;
    cursor: pointer;
    font-size: 0.8rem;
    color: #111827;
    transition: background 0.1s;
  }

  .address-btn:hover {
    background: #f3f4f6;
  }

  .monospace {
    font-family: ui-monospace, 'Cascadia Code', monospace;
  }

  .copy-icon {
    font-size: 0.75rem;
    color: #9ca3af;
  }

  .network-badge {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.625rem;
    border-radius: 9999px;
    background: #eff6ff;
    color: #1d4ed8;
    letter-spacing: 0.02em;
  }

  .disconnect-btn {
    align-self: flex-start;
    padding: 0.4rem 0.875rem;
    border: 1px solid #fca5a5;
    border-radius: 0.5rem;
    background: none;
    color: #dc2626;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.1s;
  }

  .disconnect-btn:hover {
    background: #fef2f2;
  }
</style>
