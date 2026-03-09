# Wallet Integration — Reown AppKit (Web3Modal)

This document explains how the wallet connection layer works in Vouch's
SvelteKit frontend (`apps/web`).

---

## Table of contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Quick start](#quick-start)
4. [Supported wallets & networks](#supported-wallets--networks)
5. [Using wallet state in a component](#using-wallet-state-in-a-component)
6. [Using the built-in AppKit web-components](#using-the-built-in-appkit-web-components)
7. [Adding a new network](#adding-a-new-network)
8. [Environment variables](#environment-variables)
9. [Troubleshooting](#troubleshooting)
10. [Browser compatibility](#browser-compatibility)

---

## Overview

Vouch uses **Reown AppKit v1** (formerly known as Web3Modal) together with the
**Ethers v6 adapter** to provide wallet connectivity. The integration exposes:

| Feature          | Details                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Wallet providers | MetaMask, WalletConnect, Coinbase Wallet, Trust Wallet, Rabby, 300+ via WalletConnect              |
| Networks         | Ethereum Mainnet, Sepolia testnet, Polygon, Arbitrum                                               |
| UI               | Custom `WalletButton` + `WalletStatus` Svelte components; optional `<appkit-button>` web-component |
| State management | Svelte writable stores (`$lib/wallet/store.ts`)                                                    |
| SSR safety       | AppKit is loaded only in the browser via dynamic import inside `onMount`                           |

---

## Architecture

```
apps/web/src/
├── lib/
│   ├── wallet/
│   │   ├── appkit.ts       ← AppKit singleton factory (browser-only)
│   │   └── store.ts        ← Svelte stores + subscription wiring
│   └── components/
│       ├── layout/
│       │   └── Header.svelte   ← App header with WalletButton
│       └── ui/
│           ├── WalletButton.svelte   ← Connect / Account button
│           └── WalletStatus.svelte   ← Address, network, disconnect panel
└── routes/
    ├── +layout.svelte   ← Boots AppKit in onMount, renders Header
    └── +page.svelte     ← Landing page with wallet showcase
```

### Data flow

```
onMount
  └─ import appkit.ts
       └─ getAppKit()   → creates AppKit singleton on first call
            └─ initWalletSubscriptions(modal)
                 ├─ subscribeAccount  → walletAddress, walletIsConnected
                 ├─ subscribeNetwork  → walletChainId
                 └─ subscribeState   → walletIsLoading, walletIsModalOpen
```

All stores are plain Svelte `writable`s. Any component that imports them
receives reactive updates without any extra setup.

---

## Quick start

### 1 — Obtain a Reown Project ID

Sign up for free at <https://cloud.reown.com> and create a project. Copy the
**Project ID**.

### 2 — Set the environment variable

```bash
# apps/web/.env  (copy from .env.example)
VITE_REOWN_PROJECT_ID=your_project_id_here
```

### 3 — Run the dev server

```bash
pnpm --filter @vouch/web dev
# or from the monorepo root:
pnpm dev
```

Open <http://localhost:5173>. The **Connect Wallet** button should appear in
the header. Without a Project ID the button renders but clicking it logs a
warning — no crash.

---

## Supported wallets & networks

### Wallets (out of the box via WalletConnect v2)

- MetaMask (browser extension + mobile)
- WalletConnect (QR code, any compatible wallet)
- Coinbase Wallet
- Trust Wallet
- Rabby Wallet
- Any EIP-1193 injected provider

### Networks

| Network          | Chain ID |
| ---------------- | -------- |
| Ethereum Mainnet | 1        |
| Sepolia testnet  | 11155111 |
| Polygon          | 137      |
| Arbitrum One     | 42161    |

---

## Using wallet state in a component

Import the appropriate store(s) and use auto-subscriptions with `$`:

```svelte
<script lang="ts">
  import {
    walletIsConnected,
    walletAddress,
    shortAddress,
    networkName,
  } from '$lib/wallet/store';
</script>

{#if $walletIsConnected}
  <p>Connected: {$shortAddress} on {$networkName}</p>
{:else}
  <p>Not connected</p>
{/if}
```

### Available stores

| Store               | Type                                     | Description                          |
| ------------------- | ---------------------------------------- | ------------------------------------ |
| `walletAddress`     | `Readable<\`0x${string}\` \| undefined>` | Full checksummed address             |
| `walletChainId`     | `Readable<number \| undefined>`          | Numeric chain ID                     |
| `walletIsConnected` | `Readable<boolean>`                      | True when a wallet is connected      |
| `walletIsLoading`   | `Readable<boolean>`                      | True while modal is processing       |
| `walletIsModalOpen` | `Readable<boolean>`                      | True when the AppKit overlay is open |
| `shortAddress`      | `Readable<string>`                       | Truncated address e.g. `0x1234…abcd` |
| `networkName`       | `Readable<string>`                       | Human-readable network name          |

### Triggering wallet actions

All modal actions are async and must run in the browser:

```ts
// Open connect modal
const { getAppKit } = await import('$lib/wallet/appkit');
getAppKit()?.open();

// Open account details
getAppKit()?.open({ view: 'Account' });

// Switch network
getAppKit()?.open({ view: 'Networks' });

// Disconnect
await getAppKit()?.disconnect();
```

---

## Using the built-in AppKit web-components

AppKit ships unstyled web-components as a quick drop-in alternative. After
AppKit is initialised (i.e., anywhere after the root layout has mounted) you
can use:

```svelte
<!-- Connect / Account toggle button -->
<appkit-button />

<!-- Network switcher button -->
<appkit-network-button />

<!-- Compact account pill -->
<appkit-account-button balance="show" />
```

These register themselves automatically when `createAppKit()` is called.
TypeScript types for the custom elements are declared in `src/app.d.ts`.

---

## Adding a new network

1. Import the network object from `@reown/appkit/networks`:

```ts
// src/lib/wallet/appkit.ts
import { mainnet, sepolia, polygon, arbitrum, base } from '@reown/appkit/networks';
```

2. Add it to the `networks` array in `createAppKit(...)`.

3. Optionally add a human-friendly label to the `NAMES` map in
   `src/lib/wallet/store.ts`.

---

## Environment variables

| Variable                 | Required | Description                               |
| ------------------------ | -------- | ----------------------------------------- |
| `VITE_REOWN_PROJECT_ID`  | **Yes**  | Project ID from <https://cloud.reown.com> |
| `VITE_SUPABASE_URL`      | Yes      | Supabase project URL                      |
| `VITE_SUPABASE_ANON_KEY` | Yes      | Supabase anon key                         |

All `VITE_*` variables are exposed to the browser bundle. Do **not** put
server secrets in these variables.

---

## Troubleshooting

### "Connect Wallet" does nothing / console warning about missing Project ID

Set `VITE_REOWN_PROJECT_ID` in your `apps/web/.env` file. Restart the dev
server after adding it.

### Modal opens but wallets don't appear in the list

Ensure your Project ID is registered for the domain you are testing on. For
`localhost` development this is usually auto-approved; for staging/production
add the domain under **Allowed Domains** in the [Reown Cloud dashboard](https://cloud.reown.com).

### `window is not defined` during SSR build

This means AppKit code is being evaluated server-side. Make sure:

- All calls to `getAppKit()` are inside event handlers or `onMount`.
- You are **not** calling `getAppKit()` at module top-level in any `.svelte`
  or `.ts` file that is imported during SSR.

The `browser` guard in `appkit.ts` will always return `undefined` on the
server, but it cannot prevent the module's static imports from running. The
dynamic import in `+layout.svelte`'s `onMount` is the primary SSR guard.

### TypeScript errors about `appkit-button` element

The type declarations are in `src/app.d.ts`. If you still see errors, run:

```bash
pnpm --filter @vouch/web check
```

and ensure the `.svelte-kit/tsconfig.json` is generated first:

```bash
pnpm --filter @vouch/web run check
```

### Wallet state not updating after connection

Check that `initWalletSubscriptions(modal)` is being called exactly once.
If the layout re-mounts (e.g. during HMR) the subscriptions are re-registered
which can cause duplicate state updates. The current implementation is
idempotent across normal navigation; HMR in development may occasionally
require a manual page refresh.

---

## Browser compatibility

| Browser           | Minimum version |
| ----------------- | --------------- |
| Chrome / Chromium | 90+             |
| Firefox           | 90+             |
| Safari            | 15+             |
| Edge              | 90+             |

Mobile wallets connect via [WalletConnect v2](https://docs.walletconnect.com/)
using QR code scanning or deep-links. iOS Safari 15+ and Android Chrome 90+
are supported.
