<script lang="ts">
  import { resolve } from '$app/paths';
  import { Badge } from '$lib/components/ui/badge';
  import * as Card from '$lib/components/ui/card';
  import WalletButton from '$lib/components/ui/WalletButton.svelte';
  import WalletStatus from '$lib/components/ui/WalletStatus.svelte';
  import { navLinksMap } from '$lib/navLinks';
  import { wallet } from '$lib/wallet/wallet.svelte';
  import { ArrowRight, Globe, ShieldCheck, Zap } from '@lucide/svelte';
</script>

<svelte:head>
  <title>Vouch</title>
</svelte:head>

<div class="flex flex-col items-center justify-center min-h-[80vh] space-y-20 py-12 px-4">
  <section class="max-w-[800px] text-center space-y-8 animate-in fade-in duration-700">
    <div class="flex flex-col items-center space-y-4">
      <Badge
        class="py-1 px-4 text-xs font-bold tracking-widest uppercase bg-primary/10 text-primary border-primary/20 cursor-default"
        variant="outline"
      >
        Decentralized P2P Lending
      </Badge>

      <h1 class="text-5xl md:text-7xl font-black leading-[1.05] tracking-tight text-foreground">
        Borrow & Lend Crypto<br />
        <span class="bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
          with On-Chain Trust
        </span>
      </h1>

      <p class="max-w-[600px] mx-auto text-xl text-muted-foreground font-medium leading-relaxed">
        Vouch lets you lend and borrow digital assets backed by verifiable on-chain collateral. Secure, transparent, and
        built for the future of finance.
      </p>
    </div>

    <div class="flex flex-col items-center space-y-6">
      <div class="flex items-center justify-center gap-4 flex-wrap">
        <WalletButton />
        {#if wallet.isConnected}
          <a
            class="group inline-flex items-center text-sm font-bold text-primary hover:text-primary/80 transition-colors"
            href={resolve(navLinksMap.Dashboard, {})}
          >
            Go to Dashboard
            <ArrowRight class="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
        {/if}
      </div>

      {#if wallet.isConnected}
        <div class="animate-in fade-in zoom-in duration-500">
          <WalletStatus />
        </div>
      {:else}
        <p class="text-sm text-muted-foreground/60 font-medium">
          Supports MetaMask, WalletConnect, Coinbase Wallet, and 300+ more via Web3Modal.
        </p>
      {/if}
    </div>
  </section>

  <section
    class="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-[1100px] animate-in fade-in duration-1000 delay-300"
  >
    <Card.Root
      class="group bg-card/40 backdrop-blur-sm border-border/50 hover:border-primary/50 transition-all duration-300 hover:shadow-2xl hover:shadow-primary/5"
    >
      <Card.Header>
        <div
          class="h-12 w-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300"
        >
          <ShieldCheck class="h-6 w-6 text-indigo-500" />
        </div>
        <Card.Title class="text-xl font-bold">Non-Custodial</Card.Title>
        <Card.Description class="text-base text-muted-foreground leading-relaxed">
          Your keys, your coins. Vouch utilizes battle-tested smart contracts to ensure you remain in control of your
          funds.
        </Card.Description>
      </Card.Header>
    </Card.Root>

    <Card.Root
      class="group bg-card/40 backdrop-blur-sm border-border/50 hover:border-primary/50 transition-all duration-300 hover:shadow-2xl hover:shadow-primary/5"
    >
      <Card.Header>
        <div
          class="h-12 w-12 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300"
        >
          <Zap class="h-6 w-6 text-purple-500" />
        </div>
        <Card.Title class="text-xl font-bold">On-Chain Credit</Card.Title>
        <Card.Description class="text-base text-muted-foreground leading-relaxed">
          Build your financial reputation. Credit scores are dynamically generated from your verifiable on-chain
          history.
        </Card.Description>
      </Card.Header>
    </Card.Root>

    <Card.Root
      class="group bg-card/40 backdrop-blur-sm border-border/50 hover:border-primary/50 transition-all duration-300 hover:shadow-2xl hover:shadow-primary/5"
    >
      <Card.Header>
        <div
          class="h-12 w-12 rounded-2xl bg-pink-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300"
        >
          <Globe class="h-6 w-6 text-pink-500" />
        </div>
        <Card.Title class="text-xl font-bold">Multi-Chain</Card.Title>
        <Card.Description class="text-base text-muted-foreground leading-relaxed">
          Access liquidity wherever you are. Seamless support for Ethereum, Polygon, and Arbitrum.
        </Card.Description>
      </Card.Header>
    </Card.Root>
  </section>
</div>
