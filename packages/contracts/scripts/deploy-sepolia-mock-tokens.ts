/**
 * Deploys a MockERC20 on Sepolia for every usable Chainlink USD feed, points the
 * vault's price registry at the REAL Chainlink aggregator for each one, and
 * mirrors the result into Postgres.
 *
 * The tokens are fake but the prices are real: `setPriceFeed(mockToken, feed, d)`
 * maps our deployed mock onto Chainlink's live aggregator, so LTV, liquidation
 * and the frontend price preview all exercise the production code path against
 * genuine market data.
 *
 * Prerequisites:
 *   - `scripts/fetch-chainlink-feeds.ts` has been run (writes the feed JSON)
 *   - .env has SEPOLIA_VOUCH_VAULT_ADDRESS, DATABASE_URL, SEPOLIA_RPC_URL,
 *     DEPLOYER_PRIVATE_KEY, and the deployer holds Sepolia ETH
 *   - supabase seed has created the Sepolia row in `chains`
 *
 * Usage:
 *   pnpm --filter @vouch/contracts setup:sepolia-mocks
 *   SEPOLIA_MOCK_SYMBOLS=USDC,DAI,LINK pnpm --filter @vouch/contracts setup:sepolia-mocks
 *   SEPOLIA_MOCK_MINT_TO=0xYourTestWallet pnpm --filter @vouch/contracts setup:sepolia-mocks
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { ethers, network } from 'hardhat';
import path from 'path';
import { Client } from 'pg';

import { feedsFilePath, type UsableFeed } from './fetch-chainlink-feeds';

const SEPOLIA_NETWORK_ID = '11155111';
const CHAINLINK_NETWORK = 'ethereum-testnet-sepolia';
const REGISTRY_PATH = path.resolve(__dirname, '../data/sepolia-mock-tokens.json');
const ENV_PATH = path.resolve(__dirname, '../../../.env');
const ENV_VAR = 'SEPOLIA_MOCK_TOKENS';

const VOUCH_VAULT_ABI = ['function setPriceFeed(address token, address feed, uint8 decimals_) external'];
const MOCK_ERC20_ABI = ['function mint(address account, uint256 amount) public'];

/**
 * Mirror mainnet decimals so amount formatting bugs surface here rather than in
 * production. Anything unlisted defaults to 18, the ERC20 norm.
 */
const DECIMALS_BY_SYMBOL: Record<string, number> = {
  USDC: 6,
  USDG: 6,
  PYUSD: 6,
  BTC: 8,
};
const DEFAULT_DECIMALS = 18;

/** Human-readable names for the deployed mocks; falls back to `Mock <SYMBOL>`. */
const NAME_BY_SYMBOL: Record<string, string> = {
  BTC: 'Mock Bitcoin',
  DAI: 'Mock Dai Stablecoin',
  ETH: 'Sepolia Ether',
  GHO: 'Mock Gho Token',
  LINK: 'Mock Chainlink Token',
  SNX: 'Mock Synthetix Network Token',
  USDC: 'Mock USD Coin',
  WSTETH: 'Mock Wrapped liquid staked Ether',
};

/** Units minted to the deployer (and each SEPOLIA_MOCK_MINT_TO address). */
const MINT_AMOUNT = '1000000';

type DeployedToken = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  feedAddress: string;
  /** True for native ETH, which has no contract to deploy. */
  native: boolean;
};

type Registry = Record<string, DeployedToken>;

function readRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) return {};
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8')) as Registry;
}

function writeRegistry(registry: Registry): void {
  mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');
}

function readFeeds(): UsableFeed[] {
  const feedsPath = feedsFilePath(CHAINLINK_NETWORK);
  if (!existsSync(feedsPath)) {
    throw new Error(
      `${feedsPath} not found — run "pnpm --filter @vouch/contracts fetch:chainlink-feeds" first`,
    );
  }

  const feeds = JSON.parse(readFileSync(feedsPath, 'utf-8')) as UsableFeed[];

  const only = process.env.SEPOLIA_MOCK_SYMBOLS?.split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (!only?.length) return feeds;

  const selected = feeds.filter((f) => only.includes(f.symbol));
  const missing = only.filter((s) => !feeds.some((f) => f.symbol === s));
  if (missing.length) {
    throw new Error(`SEPOLIA_MOCK_SYMBOLS contains symbols with no Sepolia feed: ${missing.join(', ')}`);
  }
  return selected;
}

function readEnvVar(env: string, name: string): string {
  const match = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
  const value = match?.[1]?.trim();
  if (!value) throw new Error(`${name} not set in ${ENV_PATH}`);
  return value;
}

function upsertEnvVar(name: string, value: string): void {
  let env = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : '';
  const line = `${name}=${value}`;

  if (new RegExp(`^${name}=`, 'm').test(env)) {
    env = env.replace(new RegExp(`^${name}=.*$`, 'm'), line);
  } else {
    if (env && !env.endsWith('\n')) env += '\n';
    env += `${line}\n`;
  }
  writeFileSync(ENV_PATH, env, 'utf-8');
}

/**
 * Writes the token row itself rather than waiting for TokensService to discover
 * it: these mocks are not indexed by RouteScan, so nothing else will ever create
 * the row that price_feed_address needs to hang off.
 */
async function upsertTokenRow(db: Client, token: DeployedToken): Promise<void> {
  const result = await db.query(
    `INSERT INTO tokens ("chainId", address, symbol, decimals, name, price_feed_address)
     SELECT id, $1, $2, $3, $4, $5 FROM chains WHERE "networkId" = $6
     ON CONFLICT ("chainId", address) DO UPDATE
     SET symbol             = EXCLUDED.symbol,
         decimals           = EXCLUDED.decimals,
         name               = EXCLUDED.name,
         price_feed_address = EXCLUDED.price_feed_address`,
    [
      ethers.getAddress(token.address),
      token.symbol,
      token.decimals,
      token.name,
      token.feedAddress,
      SEPOLIA_NETWORK_ID,
    ],
  );

  if (!result.rowCount) {
    throw new Error(
      `No chains row for networkId ${SEPOLIA_NETWORK_ID} — run the supabase seed before this script`,
    );
  }
}

async function main() {
  if (network.config.chainId !== Number(SEPOLIA_NETWORK_ID)) {
    throw new Error(`Expected Sepolia (chainId ${SEPOLIA_NETWORK_ID}), got ${network.config.chainId}`);
  }

  if (!existsSync(ENV_PATH)) throw new Error(`${ENV_PATH} not found`);
  const env = readFileSync(ENV_PATH, 'utf-8');
  const vaultAddress = readEnvVar(env, 'SEPOLIA_VOUCH_VAULT_ADDRESS');
  const databaseUrl = readEnvVar(env, 'DATABASE_URL');

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  const feeds = readFeeds();
  const registry = readRegistry();
  const mintTo = (process.env.SEPOLIA_MOCK_MINT_TO ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => ethers.getAddress(a));

  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const vault = new ethers.Contract(vaultAddress, VOUCH_VAULT_ABI, deployer);

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    for (const feed of feeds) {
      const decimals = DECIMALS_BY_SYMBOL[feed.symbol] ?? DEFAULT_DECIMALS;
      const name = NAME_BY_SYMBOL[feed.symbol] ?? `Mock ${feed.symbol}`;
      const native = feed.symbol === 'ETH';

      let token = registry[feed.symbol];

      if (token && token.decimals === decimals) {
        console.log(`${feed.symbol}: reusing ${token.address}`);
      } else if (native) {
        // ETH is the chain's native asset — the zero address is how the vault
        // and the tokens table already represent it, so there is nothing to deploy.
        token = { symbol: 'ETH', name, address: ethers.ZeroAddress, decimals: 18, feedAddress: feed.proxyAddress, native };
        console.log(`ETH: native, using zero address`);
      } else {
        const initialSupply = ethers.parseUnits(MINT_AMOUNT, decimals);
        const deployed = await MockERC20.deploy(name, feed.symbol, decimals, initialSupply);
        await deployed.waitForDeployment();
        const address = await deployed.getAddress();
        token = { symbol: feed.symbol, name, address, decimals, feedAddress: feed.proxyAddress, native };
        console.log(`${feed.symbol}: deployed ${address} (${decimals} decimals)`);
      }

      token.feedAddress = feed.proxyAddress;
      registry[feed.symbol] = token;
      // Persist after every token so a mid-run failure (out of gas, RPC hiccup)
      // doesn't orphan already-deployed contracts and pay for them twice.
      writeRegistry(registry);

      if (!native && mintTo.length) {
        const mock = new ethers.Contract(token.address, MOCK_ERC20_ABI, deployer);
        for (const recipient of mintTo) {
          await (await mock.mint(recipient, ethers.parseUnits(MINT_AMOUNT, decimals))).wait();
          console.log(`  minted ${MINT_AMOUNT} ${feed.symbol} to ${recipient}`);
        }
      }

      await (await vault.setPriceFeed(token.address, feed.proxyAddress, decimals)).wait();
      console.log(`  feed registered on-chain -> ${feed.proxyAddress}`);

      await upsertTokenRow(db, token);
      console.log(`  token row upserted in Postgres`);
    }
  } finally {
    await db.end();
  }

  // TokensService builds its Redis cache from what it just upserted, not from a
  // DB read, so these mocks would drop out of the API's token list on the next
  // sync unless the service injects them itself.
  upsertEnvVar(ENV_VAR, JSON.stringify(Object.values(registry)));
  console.log(`\nSaved ${ENV_VAR} to ${ENV_PATH} — restart the API to pick it up.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
