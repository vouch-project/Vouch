/**
 * Fetches the Chainlink price feed directory for a network and writes the subset
 * we can actually use as loan collateral to `data/chainlink-<network>-feeds.json`.
 *
 * The docs page at https://docs.chain.link/data-feeds/price-feeds/addresses is a
 * client-side React app that renders this exact JSON, so we fetch the source
 * directly instead of driving a headless browser: no Chrome dependency, no
 * pagination clicking, no breakage when the table's column order changes, and we
 * get fields the rendered table drops (decimals, heartbeat, marketHours, hidden).
 *
 * Usage:
 *   npx hardhat run scripts/fetch-chainlink-feeds.ts
 *   CHAINLINK_FEED_NETWORK=ethereum-testnet-sepolia npx hardhat run scripts/fetch-chainlink-feeds.ts
 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const DIRECTORY_BASE = 'https://reference-data-directory.vercel.app';
const DEFAULT_NETWORK = 'ethereum-testnet-sepolia';

/** Only the fields we rely on; the upstream payload has many more. */
type DirectoryFeed = {
  name?: string;
  proxyAddress?: string;
  decimals?: number;
  heartbeat?: number;
  feedCategory?: string;
  docs?: {
    hidden?: boolean;
    marketHours?: string;
    baseAssetEntityId?: string;
  };
};

export type UsableFeed = {
  /** Base asset symbol, e.g. `ETH` for the `ETH / USD` feed. */
  symbol: string;
  name: string;
  /** Aggregator proxy address — this is what `latestRoundData()` is called on. */
  proxyAddress: string;
  /** Answer decimals, i.e. the exponent to apply to `latestRoundData().answer`. */
  decimals: number;
  heartbeat: number | null;
};

/**
 * `X / USD` only. The directory also carries NAV feeds ("USTBL NAV"), realized
 * volatility ("ETH-USD 7-Day Realized Volatility"), proof-of-reserves and
 * exchange rates — none of which are a USD spot price for a token, so feeding
 * them to PriceFeedService would produce nonsense collateral valuations.
 */
const USD_PAIR = /^([A-Za-z0-9]+) \/ USD$/;

function selectUsableFeeds(feeds: DirectoryFeed[]): UsableFeed[] {
  const usable: UsableFeed[] = [];

  for (const feed of feeds) {
    const match = USD_PAIR.exec(feed.name?.trim() ?? '');
    if (!match) continue;

    // Deprecated and staging duplicates (there are two extra ETH/USD and three
    // extra BTC/USD entries on Sepolia) are flagged hidden. They still answer,
    // but they are not the canonical feed and can go stale without notice.
    if (feed.docs?.hidden === true) continue;

    // Forex, equities and metals resolve to a USD price but have no ERC20 to
    // collateralize, and their feeds pause outside market hours — which
    // PriceFeedService would (correctly) reject as stale.
    if (feed.docs?.marketHours !== 'Crypto') continue;

    if (!feed.proxyAddress || typeof feed.decimals !== 'number') continue;

    usable.push({
      symbol: match[1].toUpperCase(),
      name: feed.name!.trim(),
      proxyAddress: feed.proxyAddress,
      decimals: feed.decimals,
      heartbeat: typeof feed.heartbeat === 'number' ? feed.heartbeat : null,
    });
  }

  // Keep one feed per symbol; the directory is not guaranteed unique by pair.
  return Array.from(new Map(usable.map((f) => [f.symbol, f])).values()).sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );
}

export function feedsFilePath(network: string): string {
  return path.resolve(__dirname, `../data/chainlink-${network}-feeds.json`);
}

async function main() {
  const network = process.env.CHAINLINK_FEED_NETWORK?.trim() || DEFAULT_NETWORK;
  const url = `${DIRECTORY_BASE}/feeds-${network}.json`;

  console.log(`Fetching Chainlink feed directory: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Feed directory request failed: ${res.status} ${res.statusText}`);
  }

  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) {
    throw new Error(`Expected an array of feeds, got ${typeof raw}`);
  }

  const usable = selectUsableFeeds(raw as DirectoryFeed[]);
  if (usable.length === 0) {
    throw new Error(`No usable USD crypto feeds found for network "${network}"`);
  }

  const outPath = feedsFilePath(network);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(usable, null, 2)}\n`, 'utf-8');

  console.log(`Kept ${usable.length} of ${raw.length} feeds (non-hidden crypto X/USD pairs):`);
  for (const feed of usable) {
    console.log(`  ${feed.symbol.padEnd(8)} ${feed.proxyAddress}  ${feed.decimals} decimals`);
  }
  console.log(`\nWrote ${outPath}`);
}

// Only run when invoked directly — deploy-sepolia-mock-tokens.ts imports feedsFilePath.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
