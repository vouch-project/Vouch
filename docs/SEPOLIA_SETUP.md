# Deploying to Sepolia

Sepolia setup is **entirely manual**. Nothing in `pnpm dev`, `turbo`, or CI touches it —
[`dev-setup.sh`](../packages/contracts/dev-setup.sh) runs against `--network localhost` only.
Run the steps below by hand, in order.

The end result: mock ERC20 tokens deployed to Sepolia, each wired to a **real Chainlink
price feed**. The tokens are fake, the prices are live, so LTV, liquidation and the frontend
price preview all exercise the production code path against genuine market data.

---

## 1. Prerequisites

Set these in the root `.env`:

| Variable                | Notes                                                       |
| ----------------------- | ----------------------------------------------------------- |
| `SEPOLIA_RPC_URL`       | Alchemy / Infura endpoint. Also gates the `chains` seed row. |
| `DEPLOYER_PRIVATE_KEY`  | Must be `0x` + 64 hex chars, or Hardhat refuses to load.     |
| `DATABASE_URL`          | Direct Postgres connection.                                  |
| `SEPOLIA_WS_RPC_URL`    | Optional, for the blockchain listener.                       |
| `ETHERSCAN_API_KEY`     | Optional, for verification.                                  |

Then fund the deployer address with Sepolia ETH from a faucet. Step 4 is ~12 contract
deployments plus 13 `setPriceFeed` calls, so it needs a real balance.

> `DEPLOYER_PRIVATE_KEY` is a live signing key. Keep it out of git and never reuse a
> key that holds mainnet funds.

---

## 2. Deploy the vault

```bash
cd packages/contracts
npx hardhat run scripts/deploy.ts --network sepolia
```

Sepolia deploys write to `SEPOLIA_VOUCH_VAULT_ADDRESS`, leaving `PUBLIC_VOUCH_VAULT_ADDRESS`
(local/mainnet) untouched. The proxy is initialised with the deployer as owner — that matters,
because `setPriceFeed` in step 4 is `onlyOwner`, so the same key must run both steps.

To upgrade an existing proxy instead, add `--upgrade`.

---

## 3. Seed the `chains` row

The vault address must exist in `.env` *before* seeding, so this has to follow step 2.

```bash
cd supabase && node seed.js
```

Run it from `supabase/` — [`seed.js`](../supabase/seed.js) resolves `../.env` relative to its
own cwd. It inserts the Sepolia row only when `SEPOLIA_RPC_URL` is set, and throws if
`SEPOLIA_VOUCH_VAULT_ADDRESS` is missing. It also requires `PUBLIC_VOUCH_VAULT_ADDRESS`
to be set, even for a Sepolia-only run.

---

## 4. Fetch feeds and deploy mock tokens

```bash
pnpm --filter @vouch/contracts fetch:chainlink-feeds
pnpm --filter @vouch/contracts setup:sepolia-mocks
```

**`fetch:chainlink-feeds`** reads Chainlink's feed directory JSON — the same source the
[docs addresses page](https://docs.chain.link/data-feeds/price-feeds/addresses) renders from —
and writes `packages/contracts/data/chainlink-ethereum-testnet-sepolia-feeds.json`.

It keeps 13 of 60 feeds. The rest are dropped deliberately:

- **NAV, realized-volatility, proof-of-reserves feeds** — not a USD spot price for a token.
- **Deprecated and staging duplicates** — Sepolia has multiple live `ETH / USD` and `BTC / USD`
  feeds at different addresses. Only the `docs.hidden` flag in the JSON distinguishes them;
  the rendered HTML table does not.
- **Forex, equities, metals** — no ERC20 to collateralize, and they pause outside market hours,
  which `PriceFeedService` correctly rejects as stale.

**`setup:sepolia-mocks`** then deploys a `MockERC20` per feed with mainnet-realistic decimals,
calls `setPriceFeed(mock, realAggregator, decimals)` on the vault, and upserts the `tokens` row
with `price_feed_address`. ETH stays native at the zero address — nothing to deploy.

Useful env vars:

```bash
# Prove the flow on three tokens before spending gas on all 13
SEPOLIA_MOCK_SYMBOLS=USDC,DAI,LINK pnpm --filter @vouch/contracts setup:sepolia-mocks

# Mint 1,000,000 of each token to your browser wallet
SEPOLIA_MOCK_MINT_TO=0xYourTestWallet pnpm --filter @vouch/contracts setup:sepolia-mocks
```

Deployed addresses are recorded in `packages/contracts/data/sepolia-mock-tokens.json` after
**every** token, not at the end. A mid-run failure therefore never orphans an already-deployed
contract, and re-running reuses it rather than paying for it twice.

---

## 5. Restart the API

```bash
pnpm dev
```

Step 4 writes the registry to `SEPOLIA_MOCK_TOKENS` in `.env`, which
[`TokensService`](../apps/api/src/tokens/tokens.service.ts) reads **only at startup**.

This env var is load-bearing, not a convenience. `TokensService` builds its Redis cache from
the tokens it just upserted rather than from a database read. Without the injection these
mocks would sit in Postgres but vanish from the API's token list on the next sync — present
in the database, invisible in the UI.

---

## 6. Verify

```sql
SELECT t.symbol, t.address, t.decimals, t.price_feed_address
FROM tokens t
JOIN chains c ON c.id = t."chainId"
WHERE c."networkId" = '11155111'
ORDER BY t.symbol;
```

`price_feed_address` should be populated for every mock. Prices are fetched live
from Chainlink on-demand and cached in Redis — they are no longer stored in the DB.

---

## Troubleshooting

**`No chains row for networkId 11155111`** — step 3 didn't run, or ran before step 2 and threw
on the missing vault address.

**`SEPOLIA_MOCK_SYMBOLS contains symbols with no Sepolia feed`** — the symbol has no Sepolia
feed, or was filtered out in step 4. Check the generated feeds JSON for the valid list.

**Tokens in Postgres but missing from the app** — the API didn't restart after step 4, so
`SEPOLIA_MOCK_TOKENS` was never read. See step 5.

**Price shows null in the UI** — `PriceFeedService` rejects stale answers. Sepolia feeds have
heartbeats up to 86400s; confirm the aggregator is still being updated on-chain.

---

## Re-running

Steps 4–5 are safe to repeat. `setup:sepolia-mocks` reuses tokens already in the registry
(unless their decimals changed), re-registers each feed, and upserts the database rows.

To force a clean redeploy, delete `packages/contracts/data/sepolia-mock-tokens.json` — the old
contracts stay on-chain but are abandoned, and the `tokens` table will accumulate the stale
rows alongside the new ones.
