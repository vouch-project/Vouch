# Health Factor & Chainlink Oracle Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add on-chain health factor computation backed by Chainlink price feeds, a backend price-feed service, and frontend health factor display — partially implementing issue #19 (`liquidate()` stub only, full implementation deferred).

**Architecture:** The contract stores `liquidationThresholdBps` per loan and uses Chainlink `AggregatorV3Interface` feeds to compute health factor on-chain. The API backend reads those same feeds on a 60s interval, caches prices in Redis, and serves enriched token data to the frontend. The frontend replaces hardcoded `TOKEN_META` with API-sourced prices and shows health factor per loan using a contract read.

**Tech Stack:** Solidity ^0.8.24 + Hardhat + @chainlink/contracts, NestJS + Supabase + Redis + ethers.js v6, SvelteKit + ethers.js v6

## Global Constraints

- Solidity storage layout: all new `Loan` struct fields and contract state variables **appended**, never reordered or inserted
- `nonReentrant` on `liquidate()` even as stub
- Health factor scaled to 1e18 throughout (1e18 = 1.0)
- `liquidationThresholdBps` validated: > 0 and ≤ 10000
- `STALE_PRICE_THRESHOLD = 1 hours` in contract and API service
- Redis TTL for price cache: 30s in API
- Price feed interval: 60s, configurable via `PRICE_FEED_INTERVAL_MS` env var
- ETH/USD feed registered under `address(0)` key in contract
- Mock prices for local Hardhat: ETH = $3200, MOCK = $1000
- `liquidate()` stub must revert with `"liquidate: not implemented"` after emitting event
- Volatility values: USDC=0.02, USDT=0.03, DAI=0.04, ETH/WETH=0.45, BTC/WBTC=0.50, LINK=0.70, UNI=0.75, AAVE=0.65, MOCK=0.25, default=0.60

---

## File Map

### New files
- `packages/contracts/contracts/MockV3Aggregator.sol` — Chainlink mock for local dev/tests
- `packages/contracts/scripts/deploy-mock-aggregators.ts` — deploys mock feeds and calls `setPriceFeed`
- `apps/api/src/tokens/price-feed.service.ts` — polls Chainlink feeds, updates DB + Redis
- `supabase/migrations/20260627000000_tokens_price_feed.sql` — adds `price_usd`, `volatility`, `price_feed_address` columns
- `apps/web/src/lib/stores/tokenPrices.svelte.ts` — reactive store that fetches token prices from API
- `apps/web/src/lib/components/ui/HealthFactorBadge.svelte` — displays Safe/Warning/Liquidation Risk

### Modified files
- `packages/contracts/contracts/VouchVault.sol` — add `liquidationThresholdBps` to struct, Chainlink state vars, `setPriceFeed`, `_getPrice`, `getHealthFactor`, `liquidate` stub, update `createLoan`/`createLoanWithERC20`
- `packages/contracts/test/VouchVault.test.ts` — add tests for new functions
- `packages/contracts/dev-setup.sh` — call `deploy-mock-aggregators.ts` after deployment
- `apps/api/src/tokens/tokens.module.ts` — register `PriceFeedService`
- `apps/api/src/tokens/tokens.service.ts` — enrich `getTokens` response with `priceUsd` + `volatility`
- `apps/web/src/lib/ltv.ts` — remove `TOKEN_META`/`getTokenMeta`, update comment
- `apps/web/src/lib/wallet/vouchVault.ts` — add `getHealthFactor(loanId)`
- `apps/web/src/lib/components/ui/CreateLoan.svelte` — use `tokenPrices` store
- `apps/web/src/lib/components/dashboard/LoansTable.svelte` — add health factor column
- `apps/web/src/api/chain.ts` — add `priceUsd`/`volatility` to `Token` type

---

## Task 1: Contract — Chainlink interface + MockV3Aggregator

**Files:**
- Create: `packages/contracts/contracts/MockV3Aggregator.sol`
- Modify: `packages/contracts/package.json`

**Interfaces:**
- Produces: `MockV3Aggregator(int256 initialPrice, uint8 decimals)` constructor; `updateAnswer(int256)` for tests; implements `latestRoundData()` returning `(uint80, int256, uint256, uint256, uint80)`

- [ ] **Step 1: Install @chainlink/contracts**

```bash
cd packages/contracts && npm install @chainlink/contracts --save-dev
```

Expected: `@chainlink/contracts` appears in `package.json` devDependencies.

- [ ] **Step 2: Write MockV3Aggregator**

Create `packages/contracts/contracts/MockV3Aggregator.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockV3Aggregator {
    uint8 public decimals;
    int256 public latestAnswer;
    uint256 public updatedAt;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        latestAnswer = _initialAnswer;
        updatedAt = block.timestamp;
    }

    function updateAnswer(int256 _answer) external {
        latestAnswer = _answer;
        updatedAt = block.timestamp;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt_,
        uint80 answeredInRound
    ) {
        return (1, latestAnswer, updatedAt, updatedAt, 1);
    }
}
```

- [ ] **Step 3: Compile**

```bash
cd packages/contracts && npx hardhat compile
```

Expected: `Compiled N Solidity files successfully`

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/contracts/MockV3Aggregator.sol packages/contracts/package.json packages/contracts/package-lock.json
git commit -m "feat(contracts): add MockV3Aggregator and install @chainlink/contracts"
```

---

## Task 2: Contract — VouchVault Chainlink integration + health factor

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol`

**Interfaces:**
- Consumes: `MockV3Aggregator` (Task 1) for tests
- Produces:
  - `setPriceFeed(address token, address feed) external onlyOwner`
  - `getHealthFactor(uint256 loanId) external view returns (uint256)` — scaled to 1e18
  - `liquidate(uint256 loanId) external nonReentrant`
  - `createLoan(address, uint256, uint16, uint256, uint16) external payable` — new last param `liquidationThresholdBps`
  - `createLoanWithERC20(address, uint256, address, uint256, uint16, uint256, uint16) external` — new last param

- [ ] **Step 1: Write failing tests**

In `packages/contracts/test/VouchVault.test.ts`, add a new `describe('Chainlink & health factor')` block at the end:

```typescript
describe('Chainlink & health factor', function () {
  async function deployWithFeeds() {
    const [owner, lender, borrower] = await ethers.getSigners();
    const VouchVault = await ethers.getContractFactory('VouchVault');
    const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });

    const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
    // ETH/USD at $3200, 8 decimals (standard Chainlink)
    const ethFeed = await MockAgg.deploy(8, 3200n * 10n ** 8n);
    // MOCK/USD at $1000, 8 decimals
    const mockFeed = await MockAgg.deploy(8, 1000n * 10n ** 8n);

    const MockERC20 = await ethers.getContractFactory('MockERC20');
    const mockToken = await MockERC20.deploy('MOCK', 'MOCK', ethers.parseEther('1000000'));

    await vault.connect(owner).setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress());
    await vault.connect(owner).setPriceFeed(await mockToken.getAddress(), await mockFeed.getAddress());

    return { vault, ethFeed, mockFeed, mockToken, owner, lender, borrower };
  }

  it('setPriceFeed reverts for non-owner', async function () {
    const { vault, ethFeed, borrower } = await deployWithFeeds();
    await expect(
      vault.connect(borrower).setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress())
    ).to.be.revertedWithCustomError(vault, 'OwnableUnauthorizedAccount');
  });

  it('getHealthFactor returns correct value for ETH-collateral loan', async function () {
    // ETH collateral $3200, MOCK principal $1000, threshold 8000 bps (80%)
    // lockedCollateral = 1 ETH = 1e18 wei; remainingDebt = 1000 MOCK tokens = 1000e18
    // lockedCollateralUSD = 1e18 * 3200e18 / 1e18 = 3200e18
    // remainingDebtUSD    = 1000e18 * 1000e18 / 1e18 = 1000000e18... 
    // => use small amounts: collateral=1ETH, borrow=2 MOCK tokens (at $1000 each = $2000)
    // healthFactor = (1e18 * 3200e18/1e18 * 8000) / (2e18 * 1000e18/1e18 * 10000)
    //              = (3200e18 * 8000) / (2000e18 * 10000)
    //              = 25600000e18 / 20000000e18 = 1.28e18
    const { vault, mockToken, lender, borrower } = await deployWithFeeds();

    const collateral = ethers.parseEther('1');
    const principal = ethers.parseUnits('2', 18); // 2 MOCK tokens
    const thresholdBps = 8000;

    await vault.connect(borrower).createLoan(
      await mockToken.getAddress(), principal, 0, 0, thresholdBps, { value: collateral }
    );

    // Fund the loan
    await mockToken.transfer(lender.address, principal);
    await mockToken.connect(lender).approve(await vault.getAddress(), principal);
    await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

    const hf = await vault.getHealthFactor(0);
    // Expected: 1.28e18
    expect(hf).to.equal(128n * 10n ** 16n);
  });

  it('getHealthFactor reverts if loan not funded', async function () {
    const { vault } = await deployWithFeeds();
    const collateral = ethers.parseEther('1');
    await vault.createLoan(ethers.ZeroAddress, collateral, 0, 0, 8000, { value: collateral });
    await expect(vault.getHealthFactor(0)).to.be.revertedWith('Loan not funded');
  });

  it('liquidate reverts if health factor >= 1', async function () {
    const { vault, mockToken, lender, borrower } = await deployWithFeeds();
    const collateral = ethers.parseEther('1');
    const principal = ethers.parseUnits('2', 18);
    await vault.connect(borrower).createLoan(
      await mockToken.getAddress(), principal, 0, 0, 8000, { value: collateral }
    );
    await mockToken.transfer(lender.address, principal);
    await mockToken.connect(lender).approve(await vault.getAddress(), principal);
    await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

    await expect(vault.liquidate(0)).to.be.revertedWith('Loan is not undercollateralized');
  });

  it('liquidate emits LoanLiquidated and reverts with not implemented when undercollateralized', async function () {
    const { vault, mockToken, ethFeed, lender, borrower } = await deployWithFeeds();
    const collateral = ethers.parseEther('1');
    const principal = ethers.parseUnits('2', 18);
    await vault.connect(borrower).createLoan(
      await mockToken.getAddress(), principal, 0, 0, 8000, { value: collateral }
    );
    await mockToken.transfer(lender.address, principal);
    await mockToken.connect(lender).approve(await vault.getAddress(), principal);
    await vault.connect(lender).fundLoanWithERC20(0, await mockToken.getAddress(), principal);

    // Crash ETH price so health factor drops below 1
    await ethFeed.updateAnswer(100n * 10n ** 8n); // $100

    await expect(vault.liquidate(0))
      .to.emit(vault, 'LoanLiquidated')
      .and.to.be.revertedWith('liquidate: not implemented');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/contracts && npx hardhat test
```

Expected: multiple failures mentioning `createLoan` wrong argument count, `getHealthFactor`/`liquidate` not found.

- [ ] **Step 3: Update VouchVault.sol**

Apply all changes to `packages/contracts/contracts/VouchVault.sol`:

**a) Add import at top:**
```solidity
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
```

**b) Change contract declaration:**
```solidity
contract VouchVault is Initializable, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
```

**c) Append to `Loan` struct (after `collateralReleased`):**
```solidity
        uint16 liquidationThresholdBps;  // e.g. 6452 = 64.52%; set at creation, never changes
```

**d) Append after `lockedEthCollateral` state variable:**
```solidity
    // V5 additions — appended to preserve storage layout
    mapping(address token => AggregatorV3Interface) public priceFeeds;
    uint256 public constant STALE_PRICE_THRESHOLD = 1 hours;
```

**e) Add new event after `LoanPartiallyRepaid`:**
```solidity
    event LoanLiquidated(uint256 indexed loanId, address indexed liquidator, uint256 timestamp);
```

**f) Add `__ReentrancyGuard_init()` to `initialize`:**
```solidity
    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __ReentrancyGuard_init();
    }
```

**g) Add `liquidationThresholdBps` param to `createLoan` (new last param, validate > 0 and ≤ 10000):**
```solidity
    function createLoan(
        address principalToken,
        uint256 principalAmount,
        uint16 interestRateBps,
        uint256 durationSeconds,
        uint16 liquidationThresholdBps
    ) external payable {
        require(msg.value > 0, "Collateral must be > 0");
        require(principalAmount > 0, "Principal amount must be > 0");
        require(interestRateBps <= 10000, "Interest rate cannot exceed 100%");
        require(liquidationThresholdBps > 0 && liquidationThresholdBps <= 10000, "Invalid liquidation threshold");

        lockedEthCollateral[msg.sender] += msg.value;

        loans[nextLoanId] = Loan({
            borrower: msg.sender,
            collateralToken: address(0),
            collateralAmount: msg.value,
            createdAt: block.timestamp,
            active: true,
            collateralLocked: true,
            lender: address(0),
            principalAmount: 0,
            funded: false,
            fundedAt: 0,
            requestedPrincipalToken: principalToken,
            requestedPrincipalAmount: principalAmount,
            interestRateBps: interestRateBps,
            durationSeconds: durationSeconds,
            repaid: false,
            amountRepaid: 0,
            collateralReleased: 0,
            liquidationThresholdBps: liquidationThresholdBps
        });

        emit LoanCreated(nextLoanId, msg.sender, address(0), msg.value, principalToken, principalAmount, block.timestamp);
        nextLoanId++;
    }
```

**h) Add `liquidationThresholdBps` param to `createLoanWithERC20` (same pattern):**
```solidity
    function createLoanWithERC20(
        address token,
        uint256 amount,
        address principalToken,
        uint256 principalAmount,
        uint16 interestRateBps,
        uint256 durationSeconds,
        uint16 liquidationThresholdBps
    ) external {
        require(amount > 0, "Collateral must be > 0");
        require(token != address(0), "Invalid token address");
        require(principalAmount > 0, "Principal amount must be > 0");
        require(interestRateBps <= 10000, "Interest rate cannot exceed 100%");
        require(liquidationThresholdBps > 0 && liquidationThresholdBps <= 10000, "Invalid liquidation threshold");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        loans[nextLoanId] = Loan({
            borrower: msg.sender,
            collateralToken: token,
            collateralAmount: amount,
            createdAt: block.timestamp,
            active: true,
            collateralLocked: true,
            lender: address(0),
            principalAmount: 0,
            funded: false,
            fundedAt: 0,
            requestedPrincipalToken: principalToken,
            requestedPrincipalAmount: principalAmount,
            interestRateBps: interestRateBps,
            durationSeconds: durationSeconds,
            repaid: false,
            amountRepaid: 0,
            collateralReleased: 0,
            liquidationThresholdBps: liquidationThresholdBps
        });

        emit LoanCreated(nextLoanId, msg.sender, token, amount, principalToken, principalAmount, block.timestamp);
        nextLoanId++;
    }
```

**i) Add new functions before `// --- View Functions ---`:**
```solidity
    // --- Oracle Functions ---

    function setPriceFeed(address token, address feed) external onlyOwner {
        require(feed != address(0), "Invalid feed address");
        priceFeeds[token] = AggregatorV3Interface(feed);
    }

    function _getPrice(address token) internal view returns (uint256) {
        AggregatorV3Interface feed = priceFeeds[token];
        require(address(feed) != address(0), "No price feed for token");
        (, int256 price, , uint256 updatedAt, ) = feed.latestRoundData();
        require(price > 0, "Invalid price");
        require(block.timestamp - updatedAt <= STALE_PRICE_THRESHOLD, "Stale price");
        uint8 feedDecimals = feed.decimals();
        // Normalize to 18 decimals
        if (feedDecimals < 18) {
            return uint256(price) * (10 ** (18 - feedDecimals));
        } else if (feedDecimals > 18) {
            return uint256(price) / (10 ** (feedDecimals - 18));
        }
        return uint256(price);
    }

    function getHealthFactor(uint256 loanId) external view returns (uint256) {
        Loan memory loan = loans[loanId];
        require(loan.funded, "Loan not funded");
        require(!loan.repaid, "Loan already repaid");

        uint256 totalDue = loan.principalAmount + (loan.principalAmount * loan.interestRateBps) / 10000;
        uint256 remainingDebt = totalDue > loan.amountRepaid ? totalDue - loan.amountRepaid : 0;
        require(remainingDebt > 0, "No remaining debt");

        uint256 lockedCollateral = loan.collateralAmount - loan.collateralReleased;

        uint256 collateralPrice = _getPrice(loan.collateralToken);
        uint256 principalPrice  = _getPrice(loan.requestedPrincipalToken);

        // All amounts are in their token's native decimals (wei for ETH, token units for ERC20).
        // Prices are 1e18-scaled USD per token-unit.
        // lockedCollateralUSD and remainingDebtUSD share the same 1e18 scale factor,
        // so it cancels in the ratio — no additional scaling needed.
        uint256 lockedCollateralUSD = lockedCollateral * collateralPrice;
        uint256 remainingDebtUSD    = remainingDebt    * principalPrice;

        return (lockedCollateralUSD * loan.liquidationThresholdBps) / (remainingDebtUSD / 1e18 * 10000);
    }

    function liquidate(uint256 loanId) external nonReentrant {
        require(this.getHealthFactor(loanId) < 1e18, "Loan is not undercollateralized");
        emit LoanLiquidated(loanId, msg.sender, block.timestamp);
        revert("liquidate: not implemented");
    }
```

- [ ] **Step 4: Run tests**

```bash
cd packages/contracts && npx hardhat test
```

Expected: all tests pass including the new Chainlink block.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): add Chainlink price feeds, getHealthFactor, liquidate stub"
```

---

## Task 3: Contract — update existing tests + deploy scripts

**Files:**
- Modify: `packages/contracts/test/VouchVault.test.ts` — fix existing `createLoan`/`createLoanWithERC20` calls that now need `liquidationThresholdBps`
- Create: `packages/contracts/scripts/deploy-mock-aggregators.ts`
- Modify: `packages/contracts/dev-setup.sh`

**Interfaces:**
- Consumes: `VouchVault.setPriceFeed` (Task 2)

- [ ] **Step 1: Fix existing test calls**

Every existing call to `createLoan(...)` and `createLoanWithERC20(...)` in the test file now needs `liquidationThresholdBps` as the last argument. Add `8000` (80%) as the default for all existing tests. Search and replace:

```typescript
// Before (ETH loan):
vault.createLoan(principalTokenAddress, principalAmount, interestRateBps, durationSeconds, { value: ... })
// After:
vault.createLoan(principalTokenAddress, principalAmount, interestRateBps, durationSeconds, 8000, { value: ... })

// Before (ERC20 loan):
vault.createLoanWithERC20(token, amount, principalToken, principalAmount, interestRateBps, durationSeconds)
// After:
vault.createLoanWithERC20(token, amount, principalToken, principalAmount, interestRateBps, durationSeconds, 8000)
```

- [ ] **Step 2: Run tests to confirm all pass**

```bash
cd packages/contracts && npx hardhat test
```

Expected: all tests pass.

- [ ] **Step 3: Create deploy-mock-aggregators.ts**

Create `packages/contracts/scripts/deploy-mock-aggregators.ts`:

```typescript
import { ethers } from 'hardhat';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

async function main() {
  const [deployer] = await ethers.getSigners();

  const envPath = path.resolve(__dirname, '../../../.env');
  if (!existsSync(envPath)) throw new Error('.env not found');
  const env = readFileSync(envPath, 'utf-8');

  const vaultMatch = env.match(/^PUBLIC_VOUCH_VAULT_ADDRESS=(.*)$/m);
  if (!vaultMatch) throw new Error('PUBLIC_VOUCH_VAULT_ADDRESS not set in .env');
  const vaultAddress = vaultMatch[1].trim();

  const mockErc20Match = env.match(/^HARDCODED_MOCK_ERC20_ADDRESS=(.*)$/m);
  if (!mockErc20Match) throw new Error('HARDCODED_MOCK_ERC20_ADDRESS not set in .env');
  const mockErc20Address = mockErc20Match[1].trim();

  const MockAgg = await ethers.getContractFactory('MockV3Aggregator');

  // ETH/USD: $3200, 8 decimals
  const ethFeed = await MockAgg.deploy(8, 3200n * 10n ** 8n);
  await ethFeed.waitForDeployment();
  console.log(`ETH/USD MockAggregator deployed to: ${await ethFeed.getAddress()}`);

  // MOCK/USD: $1000, 8 decimals
  const mockFeed = await MockAgg.deploy(8, 1000n * 10n ** 8n);
  await mockFeed.waitForDeployment();
  console.log(`MOCK/USD MockAggregator deployed to: ${await mockFeed.getAddress()}`);

  const VouchVaultAbi = [
    'function setPriceFeed(address token, address feed) external',
  ];
  const vault = new ethers.Contract(vaultAddress, VouchVaultAbi, deployer);

  await vault.setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress());
  console.log('ETH price feed registered');

  await vault.setPriceFeed(mockErc20Address, await mockFeed.getAddress());
  console.log('MOCK price feed registered');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
```

- [ ] **Step 4: Add to dev-setup.sh**

In `packages/contracts/dev-setup.sh`, after the `mint-mock-to-wallets.ts` line, add:

```bash
    # Deploy mock Chainlink price feeds and register them on VouchVault
    npx hardhat run scripts/deploy-mock-aggregators.ts --network localhost
```

- [ ] **Step 5: Rebuild ABI**

```bash
cd packages/contracts && pnpm build
```

Expected: `packages/abi/VouchVault.json` updated with new functions.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/test/VouchVault.test.ts packages/contracts/scripts/deploy-mock-aggregators.ts packages/contracts/dev-setup.sh packages/abi/
git commit -m "feat(contracts): update tests and dev-setup for Chainlink mock feeds"
```

---

## Task 4: Database migration — tokens table enrichment

**Files:**
- Create: `supabase/migrations/20260627000000_tokens_price_feed.sql`

**Interfaces:**
- Produces: `tokens.price_usd` (float8 nullable), `tokens.volatility` (float4 nullable), `tokens.price_feed_address` (text nullable)

- [ ] **Step 1: Create migration**

Create `supabase/migrations/20260627000000_tokens_price_feed.sql`:

```sql
-- Add price feed columns to tokens table.
-- All nullable: existing rows are not broken before prices are populated.
ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS price_usd          float8,
  ADD COLUMN IF NOT EXISTS volatility         float4,
  ADD COLUMN IF NOT EXISTS price_feed_address text;

-- Seed volatility for known symbols. price_usd will be populated by PriceFeedService.
-- price_feed_address is set per-environment via the API config (not stored in migration).
UPDATE public.tokens SET volatility = CASE symbol
  WHEN 'USDC'  THEN 0.02
  WHEN 'USDT'  THEN 0.03
  WHEN 'DAI'   THEN 0.04
  WHEN 'ETH'   THEN 0.45
  WHEN 'WETH'  THEN 0.45
  WHEN 'BTC'   THEN 0.50
  WHEN 'WBTC'  THEN 0.50
  WHEN 'LINK'  THEN 0.70
  WHEN 'UNI'   THEN 0.75
  WHEN 'AAVE'  THEN 0.65
  WHEN 'MOCK'  THEN 0.25
  ELSE 0.60
END
WHERE volatility IS NULL;
```

- [ ] **Step 2: Apply migration locally**

```bash
npx supabase db reset
```

Expected: migration applies cleanly, `tokens` table has new columns.

- [ ] **Step 3: Regenerate TypeScript types**

```bash
pnpm db:generate:types
```

Expected: `packages/database-types/src/generated.ts` updated with `price_usd`, `volatility`, `price_feed_address` on the `tokens` row type.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260627000000_tokens_price_feed.sql packages/database-types/
git commit -m "feat(db): add price_usd, volatility, price_feed_address to tokens table"
```

---

## Task 5: API — PriceFeedService

**Files:**
- Create: `apps/api/src/tokens/price-feed.service.ts`
- Modify: `apps/api/src/tokens/tokens.module.ts`

**Interfaces:**
- Consumes: `SupabaseService`, `ConfigService`, `Redis` (all already in TokensModule); `tokens.price_feed_address` (Task 4)
- Produces: `PriceFeedService` injectable; Redis key `prices:cache` (JSON `Record<string, number>`, 30s TTL); `tokens.price_usd` updated in DB

- [ ] **Step 1: Create PriceFeedService**

Create `apps/api/src/tokens/price-feed.service.ts`:

```typescript
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import type { Redis } from 'ioredis';
import { SupabaseService } from '../supabase/supabase.service';

const AGGREGATOR_ABI = [
  'function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)',
  'function decimals() external view returns (uint8)',
];

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const REDIS_KEY = 'prices:cache';
const REDIS_TTL = 30; // seconds

@Injectable()
export class PriceFeedService implements OnModuleInit {
  private readonly logger = new Logger(PriceFeedService.name);
  private intervalMs: number;
  private provider: ethers.JsonRpcProvider;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.intervalMs = Number(
      this.configService.get<string>('PRICE_FEED_INTERVAL_MS') ?? '60000',
    );
    const rpcUrl = this.configService.getOrThrow<string>('RPC_URL');
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async onModuleInit() {
    await this.refreshPrices();
    setInterval(() => void this.refreshPrices(), this.intervalMs);
  }

  async getPrices(): Promise<Record<string, number>> {
    const cached = await this.redis.get(REDIS_KEY);
    if (cached) {
      try { return JSON.parse(cached) as Record<string, number>; } catch {}
    }
    await this.refreshPrices();
    const fresh = await this.redis.get(REDIS_KEY);
    return fresh ? (JSON.parse(fresh) as Record<string, number>) : {};
  }

  private async refreshPrices(): Promise<void> {
    try {
      const { data: tokens, error } = await this.supabaseService.client
        .from('tokens')
        .select('address, symbol, price_feed_address')
        .not('price_feed_address', 'is', null);

      if (error || !tokens?.length) return;

      const priceMap: Record<string, number> = {};

      await Promise.all(
        tokens.map(async (token) => {
          try {
            const feed = new ethers.Contract(
              token.price_feed_address!,
              AGGREGATOR_ABI,
              this.provider,
            );
            const [, answer, , updatedAt] = await feed.latestRoundData() as [unknown, bigint, unknown, bigint, unknown];
            const decimals: number = await feed.decimals();

            if (answer <= 0n) return;
            if (Date.now() - Number(updatedAt) * 1000 > STALE_THRESHOLD_MS) {
              this.logger.warn(`Stale price for ${token.symbol}`);
              return;
            }

            const price = Number(answer) / 10 ** decimals;
            priceMap[token.symbol] = price;

            await this.supabaseService.client
              .from('tokens')
              .update({ price_usd: price })
              .eq('address', token.address);
          } catch (err) {
            this.logger.warn(`Failed to fetch price for ${token.symbol}: ${err}`);
          }
        }),
      );

      await this.redis.set(REDIS_KEY, JSON.stringify(priceMap), 'EX', REDIS_TTL);
      this.logger.log(`Prices refreshed: ${Object.keys(priceMap).join(', ')}`);
    } catch (err) {
      this.logger.error('Price refresh failed:', err);
    }
  }
}
```

- [ ] **Step 2: Register in TokensModule**

Update `apps/api/src/tokens/tokens.module.ts`:

```typescript
import { RedisModule } from '@nestjs-modules/ioredis';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { TokensService } from './tokens.service';
import { PriceFeedService } from './price-feed.service';

@Module({
  imports: [
    HttpModule.register({ timeout: 5000 }),
    SupabaseModule,
    RedisModule,
  ],
  providers: [TokensService, PriceFeedService],
  exports: [TokensService, PriceFeedService],
})
export class TokensModule {}
```

- [ ] **Step 3: Add RPC_URL to .env.example**

In the root `.env.example`, add:

```
RPC_URL=http://localhost:8545
PRICE_FEED_INTERVAL_MS=60000
```

- [ ] **Step 4: Verify API compiles**

```bash
cd apps/api && pnpm build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tokens/price-feed.service.ts apps/api/src/tokens/tokens.module.ts .env.example
git commit -m "feat(api): add PriceFeedService to poll Chainlink feeds and cache prices"
```

---

## Task 6: API — enrich GET /tokens with priceUsd + volatility

**Files:**
- Modify: `apps/api/src/tokens/tokens.service.ts`
- Modify: `apps/api/src/chains/chains.service.ts` (pass enriched tokens through)

**Interfaces:**
- Consumes: `PriceFeedService.getPrices()` (Task 5); `tokens.volatility` (Task 4)
- Produces: `ResponseToken` extended with `priceUsd: number | null` and `volatility: number | null`; served via existing `GET /chains?networkId=X` endpoint

- [ ] **Step 1: Extend ResponseToken type in tokens.service.ts**

In `apps/api/src/tokens/tokens.service.ts`, update the `ResponseToken` type:

```typescript
export type ResponseToken = {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  name: string | null;
  logoURI: string | null;
  priceUSD?: string;
  coinKey?: string;
  priceUsd: number | null;    // add
  volatility: number | null;  // add
};
```

- [ ] **Step 2: Inject PriceFeedService and enrich getTokens**

In `apps/api/src/tokens/tokens.service.ts`, inject `PriceFeedService` and update `getTokens`:

```typescript
// Add to constructor:
constructor(
  private readonly httpService: HttpService,
  private readonly supabaseService: SupabaseService,
  private readonly configService: ConfigService,
  private readonly priceFeedService: PriceFeedService,
  @InjectRedis() private readonly redis: Redis,
) {}

// Update getTokens:
async getTokens(networkId: string): Promise<ResponseToken[]> {
  const redisKey = `${this.redisKeyPrefix}${networkId}`;
  const cached = await this.redis.get(redisKey);

  let tokens: ResponseToken[] = [];
  if (cached) {
    const parsed = this.parseTokens(cached, networkId);
    if (parsed) tokens = parsed;
  }

  if (!tokens.length) {
    await this.fetchTokenList();
    const refreshed = await this.redis.get(redisKey);
    tokens = refreshed ? (this.parseTokens(refreshed, networkId) ?? []) : [];
  }

  // Enrich with live prices and volatility from DB
  const prices = await this.priceFeedService.getPrices();

  const { data: dbTokens } = await this.supabaseService.client
    .from('tokens')
    .select('symbol, price_usd, volatility')
    .in('symbol', tokens.map((t) => t.symbol));

  const dbBySymbol = new Map((dbTokens ?? []).map((t) => [t.symbol, t]));

  return tokens.map((t) => ({
    ...t,
    priceUsd: prices[t.symbol] ?? dbBySymbol.get(t.symbol)?.price_usd ?? null,
    volatility: dbBySymbol.get(t.symbol)?.volatility ?? null,
  }));
}
```

- [ ] **Step 3: Verify API compiles**

```bash
cd apps/api && pnpm build
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/tokens/tokens.service.ts
git commit -m "feat(api): enrich GET /tokens response with priceUsd and volatility"
```

---

## Task 7: Frontend — tokenPrices store + ltv.ts refactor

**Files:**
- Create: `apps/web/src/lib/stores/tokenPrices.svelte.ts`
- Modify: `apps/web/src/lib/ltv.ts`
- Modify: `apps/web/src/api/chain.ts`

**Interfaces:**
- Consumes: `GET /chains?networkId=X` response with `priceUsd`/`volatility` fields (Task 6)
- Produces:
  - `tokenPrices` store: `{ getTokenMeta(symbol: string): TokenMeta }`
  - `TokenMeta` interface (unchanged): `{ priceUsd: number; volatility: number }`
  - `ltv.ts`: exports `baseLtv`, `scoreMult`, `maxLtv` (unchanged signatures); removes `TOKEN_META`, `getTokenMeta`, `DEFAULT_TOKEN_META`

- [ ] **Step 1: Add priceUsd/volatility to Token type**

In `apps/web/src/api/chain.ts`, update `Token`:

```typescript
export type Token = {
  id: UUID;
  chainId: string;
  address: string;
  symbol: string;
  decimals: number;
  name: string | null;
  logoURI: string | null;
  priceUsd: number | null;    // add
  volatility: number | null;  // add
};
```

- [ ] **Step 2: Create tokenPrices store**

Create `apps/web/src/lib/stores/tokenPrices.svelte.ts`:

```typescript
import { chainInfo } from './chainInfo.svelte';
import type { TokenMeta } from '$lib/ltv';

export const DEFAULT_TOKEN_META: TokenMeta = { priceUsd: 1, volatility: 0.6 };

class TokenPrices {
  private map = $state<Record<string, TokenMeta>>({});

  getTokenMeta(symbol: string | null | undefined): TokenMeta {
    return this.map[symbol ?? ''] ?? DEFAULT_TOKEN_META;
  }

  sync() {
    const next: Record<string, TokenMeta> = {};
    for (const token of chainInfo.tokens) {
      if (token.priceUsd != null && token.volatility != null) {
        next[token.symbol] = { priceUsd: token.priceUsd, volatility: token.volatility };
      }
    }
    this.map = next;
  }
}

export const tokenPrices = new TokenPrices();
```

Note: `tokenPrices.sync()` is called whenever `chainInfo.tokens` updates (wired in the next step). This avoids a separate fetch — the chain info fetch already returns enriched tokens.

- [ ] **Step 3: Call sync() when chainInfo updates**

In `apps/web/src/routes/+layout.svelte` (or wherever `chainInfo` is populated from the API response), add after setting `chainInfo.tokens`:

```typescript
import { tokenPrices } from '$lib/stores/tokenPrices.svelte';
// ...
// After: chainInfo.tokens = data.tokens;
tokenPrices.sync();
```

Find the exact location by searching for `chainInfo.tokens =` in the web app.

- [ ] **Step 4: Refactor ltv.ts**

Replace the contents of `apps/web/src/lib/ltv.ts`:

```typescript
/**
 * LTV (Loan-to-Value) calculation utilities.
 *
 * Token prices and volatility are now served by the API (sourced from Chainlink
 * price feeds). Use the `tokenPrices` store to get TokenMeta for a given symbol.
 * Volatility is maintained as a DB column (manually set, future: computed from
 * historical price data via ATR/rolling std dev).
 */

export interface TokenMeta {
  priceUsd: number;
  /** 0–1. Higher volatility = lower allowed LTV. */
  volatility: number;
}

// Volatility drives the base max-LTV: low-vol stables → 90%, high-vol assets → 50%.
// baseLTV = 90 - volatility * 40   (range: 50%–90%)
export const baseLtv = (collateralMeta: TokenMeta, borrowMeta: TokenMeta): number => {
  const v = Math.max(collateralMeta.volatility, borrowMeta.volatility);
  return 90 - v * 40;
};

/**
 * Credit-score multiplier applied on top of the base LTV.
 * score 300 → 0.50×, score 770 → 1.00×, score 850 → 1.10×
 */
export const scoreMult = (score: number | null | undefined): number => {
  if (score == null) return 1;
  const clamped = Math.max(300, Math.min(850, score));
  return 0.5 + ((clamped - 300) / 550) * 0.6;
};

/** Final max LTV = base LTV adjusted by the borrower's credit score. */
export const maxLtv = (
  collateralMeta: TokenMeta,
  borrowMeta: TokenMeta,
  score: number | null | undefined,
): number => baseLtv(collateralMeta, borrowMeta) * scoreMult(score);
```

Note: `baseLtv` and `maxLtv` now take `TokenMeta` objects directly instead of symbol strings. Callers get these from `tokenPrices.getTokenMeta(symbol)`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/stores/tokenPrices.svelte.ts apps/web/src/lib/ltv.ts apps/web/src/api/chain.ts
git commit -m "feat(web): add tokenPrices store, refactor ltv.ts to use API-sourced prices"
```

---

## Task 8: Frontend — update CreateLoan.svelte

**Files:**
- Modify: `apps/web/src/lib/components/ui/CreateLoan.svelte`

**Interfaces:**
- Consumes: `tokenPrices.getTokenMeta(symbol)` (Task 7); `maxLtv(collateralMeta, borrowMeta, score)` (Task 7)

- [ ] **Step 1: Update imports and derived values**

In `apps/web/src/lib/components/ui/CreateLoan.svelte`, replace the ltv import block and derived price calculations:

```typescript
// Remove:
import { getTokenMeta, maxLtv } from '$lib/ltv';

// Add:
import { maxLtv } from '$lib/ltv';
import { tokenPrices } from '$lib/stores/tokenPrices.svelte';

// Replace:
// const computedMaxLtv = $derived(maxLtv(selectedCollateralToken, selectedBorrowToken, creditScore));
// const collateralUsd = $derived((parseFloat(collateralAmount) || 0) * getTokenMeta(selectedCollateralToken).priceUsd);
// const borrowUsd = $derived((parseFloat(borrowAmount) || 0) * getTokenMeta(selectedBorrowToken).priceUsd);

// With:
const collateralMeta = $derived(tokenPrices.getTokenMeta(selectedCollateralToken));
const borrowMeta = $derived(tokenPrices.getTokenMeta(selectedBorrowToken));
const computedMaxLtv = $derived(maxLtv(collateralMeta, borrowMeta, creditScore));
const collateralUsd = $derived((parseFloat(collateralAmount) || 0) * collateralMeta.priceUsd);
const borrowUsd = $derived((parseFloat(borrowAmount) || 0) * borrowMeta.priceUsd);
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/components/ui/CreateLoan.svelte
git commit -m "feat(web): wire CreateLoan to tokenPrices store"
```

---

## Task 9: Frontend — getHealthFactor + HealthFactorBadge

**Files:**
- Modify: `apps/web/src/lib/wallet/vouchVault.ts`
- Create: `apps/web/src/lib/components/ui/HealthFactorBadge.svelte`
- Modify: `apps/web/src/lib/components/dashboard/LoansTable.svelte`
- Modify: `apps/web/src/lib/components/dashboard/columns.ts`

**Interfaces:**
- Consumes: `getVouchVaultContract()` (existing in vouchVault.ts); `LoanFull` type (from database-types)
- Produces: `getHealthFactor(loanId: bigint): Promise<bigint>` — returns raw 1e18-scaled value from contract

- [ ] **Step 1: Add getHealthFactor to vouchVault.ts**

In `apps/web/src/lib/wallet/vouchVault.ts`, add at the end:

```typescript
/**
 * Returns the health factor for a funded, non-repaid loan.
 * Scaled to 1e18: 1e18n = 1.0, 1.5e18n = 1.5, etc.
 * Reverts if loan is not funded or already repaid.
 */
export const getHealthFactor = async (onChainLoanId: bigint): Promise<bigint> => {
  const contract = await getVouchVaultContract();
  return contract.getHealthFactor(onChainLoanId) as Promise<bigint>;
};
```

- [ ] **Step 2: Create HealthFactorBadge.svelte**

Create `apps/web/src/lib/components/ui/HealthFactorBadge.svelte`:

```svelte
<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';

  type Props = {
    healthFactor: bigint | null;
    loading?: boolean;
  };

  let { healthFactor, loading = false }: Props = $props();

  const ONE = 10n ** 18n;

  const status = $derived(
    healthFactor === null
      ? null
      : healthFactor >= 15n * ONE / 10n
        ? 'Safe'
        : healthFactor >= ONE
          ? 'Warning'
          : 'Liquidation Risk'
  );

  const variant = $derived(
    status === 'Safe' ? 'default'
    : status === 'Warning' ? 'secondary'
    : 'destructive'
  );

  const formatted = $derived(
    healthFactor !== null
      ? (Number(healthFactor) / 1e18).toFixed(2)
      : null
  );
</script>

{#if loading}
  <div class="h-5 w-16 bg-muted animate-pulse rounded"></div>
{:else if status && formatted}
  <Badge variant={status === 'Warning' ? 'outline' : variant}
    class={status === 'Warning' ? 'border-yellow-500 text-yellow-600' : ''}>
    {formatted} · {status}
  </Badge>
{:else}
  <span class="text-muted-foreground text-xs">—</span>
{/if}
```

- [ ] **Step 3: Add Health Factor column to columns.ts**

In `apps/web/src/lib/components/dashboard/columns.ts`, add a health factor column to the `tableColumns` array:

```typescript
{ label: 'Health Factor', width: 'w-36', align: 'center' },
```

- [ ] **Step 4: Wire up health factor in LoanRepayRow.svelte**

Open `apps/web/src/lib/components/ui/LoanRepayRow.svelte`. Add health factor fetch and display. At the top of the `<script>`, add:

```typescript
import { getHealthFactor } from '$lib/wallet/vouchVault';
import HealthFactorBadge from './HealthFactorBadge.svelte';

// Add after existing state:
let healthFactor = $state<bigint | null>(null);
let hfLoading = $state(false);

$effect(() => {
  if (!loan.onChainLoanId || !loan.funded || loan.repaid) return;
  hfLoading = true;
  getHealthFactor(BigInt(loan.onChainLoanId))
    .then((hf) => { healthFactor = hf; })
    .catch(() => { healthFactor = null; })
    .finally(() => { hfLoading = false; });
});
```

In the row template, add a `<Table.Cell>` with `<HealthFactorBadge {healthFactor} loading={hfLoading} />` in the position matching the new column.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/wallet/vouchVault.ts apps/web/src/lib/components/ui/HealthFactorBadge.svelte apps/web/src/lib/components/dashboard/columns.ts apps/web/src/lib/components/ui/LoanRepayRow.svelte
git commit -m "feat(web): add health factor display to dashboard loans table"
```

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Task |
|-----------------|------|
| `liquidationThresholdBps` appended to Loan struct | Task 2 |
| `priceFeeds` mapping + `STALE_PRICE_THRESHOLD` state vars | Task 2 |
| `setPriceFeed` owner-only function | Task 2 |
| `_getPrice` internal with decimal normalization + stale guard | Task 2 |
| `getHealthFactor` view returning 1e18-scaled value | Task 2 |
| `liquidate` stub with nonReentrant, event, revert | Task 2 |
| `LoanLiquidated` event | Task 2 |
| `createLoan`/`createLoanWithERC20` updated with new param | Task 2 |
| `MockV3Aggregator` for local dev | Task 1, 3 |
| `deploy-mock-aggregators.ts` + `dev-setup.sh` update | Task 3 |
| DB migration adding 3 columns | Task 4 |
| Volatility seeded in migration | Task 4 |
| `PriceFeedService` polling Chainlink, caching in Redis | Task 5 |
| `GET /tokens` enriched with `priceUsd` + `volatility` | Task 6 |
| `tokenPrices` store replacing `TOKEN_META` | Task 7 |
| `ltv.ts` updated (remove hardcoded map, update signatures) | Task 7 |
| `CreateLoan.svelte` using store prices | Task 8 |
| `getHealthFactor` in vouchVault.ts | Task 9 |
| `HealthFactorBadge` with Safe/Warning/Liquidation Risk | Task 9 |
| Health factor on dashboard table | Task 9 |

### Type consistency check

- `TokenMeta` interface defined in `ltv.ts` (Task 7), consumed by `tokenPrices` store (Task 7) and `CreateLoan.svelte` (Task 8) ✓
- `getHealthFactor` returns `bigint` in vouchVault.ts (Task 9); `HealthFactorBadge` accepts `bigint | null` (Task 9) ✓
- `baseLtv(collateralMeta: TokenMeta, borrowMeta: TokenMeta)` — new signature used consistently in Task 7 and Task 8 ✓
- `ResponseToken.priceUsd` added in Task 6, `Token.priceUsd` added in Task 7 — both `number | null` ✓
