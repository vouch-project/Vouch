<script lang="ts">
  import WalletButton from '$lib/components/ui/WalletButton.svelte';
  import WalletStatus from '$lib/components/ui/WalletStatus.svelte';
  import { walletIsConnected } from '$lib/wallet/store';
</script>

<section class="hero">
  <div class="badge">Decentralized P2P Lending</div>
  <h1>Borrow &amp; Lend Crypto<br />with <span class="accent">On-Chain Trust</span></h1>
  <p class="subtitle">
    Vouch lets you lend and borrow digital assets backed by verifiable on-chain collateral. Connect your wallet to get
    started.
  </p>

  <div class="cta-group">
    <WalletButton />
    {#if $walletIsConnected}
      <a href="/dashboard" class="cta-secondary">Go to Dashboard →</a>
    {/if}
  </div>

  {#if $walletIsConnected}
    <div class="status-wrapper">
      <WalletStatus />
    </div>
  {:else}
    <p class="hint">Supports MetaMask, WalletConnect, Coinbase Wallet, and 300+ more via Web3Modal.</p>
  {/if}
</section>

<section class="features">
  <div class="feature-card">
    <span class="icon">🔒</span>
    <h3>Non-Custodial</h3>
    <p>Your keys, your coins. Vouch never holds your funds.</p>
  </div>
  <div class="feature-card">
    <span class="icon">⚡</span>
    <h3>On-Chain Credit</h3>
    <p>Credit scores powered by verifiable on-chain history.</p>
  </div>
  <div class="feature-card">
    <span class="icon">🌐</span>
    <h3>Multi-Chain</h3>
    <p>Ethereum, Polygon, and Arbitrum supported out of the box.</p>
  </div>
</section>

<style>
  .hero {
    text-align: center;
    padding: 4rem 1rem 3rem;
  }

  .badge {
    display: inline-block;
    padding: 0.3rem 0.875rem;
    border-radius: 9999px;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 1.25rem;
  }

  h1 {
    font-size: clamp(2rem, 5vw, 3.25rem);
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: -0.03em;
    margin-bottom: 1.25rem;
    color: #111827;
  }

  .accent {
    color: #4f46e5;
  }

  .subtitle {
    max-width: 540px;
    margin: 0 auto 2rem;
    color: #6b7280;
    font-size: 1.0625rem;
    line-height: 1.6;
  }

  .cta-group {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1.75rem;
  }

  .cta-secondary {
    font-size: 0.9rem;
    font-weight: 600;
    color: #4f46e5;
    text-decoration: none;
  }

  .cta-secondary:hover {
    text-decoration: underline;
  }

  .status-wrapper {
    display: inline-block;
    margin-top: 0.5rem;
  }

  .hint {
    font-size: 0.8rem;
    color: #9ca3af;
    margin-top: 0.25rem;
  }

  /* Features grid */
  .features {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1.25rem;
    margin-top: 3rem;
  }

  .feature-card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 1rem;
    padding: 1.5rem;
    text-align: left;
  }

  .feature-card .icon {
    font-size: 1.75rem;
    display: block;
    margin-bottom: 0.75rem;
  }

  .feature-card h3 {
    font-size: 1rem;
    font-weight: 700;
    margin-bottom: 0.375rem;
    color: #111827;
  }

  .feature-card p {
    font-size: 0.875rem;
    color: #6b7280;
    line-height: 1.5;
  }
</style>
