# EIP-712 Gasless Signed Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let borrowers sign `LoanRequest`s and lenders sign `LendOffer`s off-chain (gasless), then have the counterparty fill them on-chain via EIP-712 signature verification.

**Architecture:** Add EIP-712 typed-data signing to the existing `VouchVault` UUPS contract with two new signed-order structs and `fill*`/`cancel*` functions. Off-chain signatures are stored/served by a new NestJS controller+service backed by two Supabase tables. The frontend signs with ethers `signTypedData`; the blockchain-listener mirrors on-chain fill/cancel events into the DB. Native ETH stays on the existing on-chain path — signed orders commit ERC20 on the signer's side only.

**Tech Stack:** Solidity 0.8.24 + OpenZeppelin upgradeable (`EIP712Upgradeable`, `ECDSA`), Hardhat + ethers v6 tests, NestJS + class-validator, Supabase/Postgres, SvelteKit + ethers v6.

**Spec:** `docs/superpowers/specs/2026-08-21-eip712-gasless-signed-orders-design.md`

## Global Constraints

- EIP-712 domain: `name = "Vouch"`, `version = "1"`, `chainId` = live chain id, `verifyingContract` = vault proxy address. These four values MUST be identical across contract, API verifier, and frontend signer.
- Type strings (verbatim, field order is significant for the typehash):
  - `LoanRequest(address borrower,address collateralToken,uint256 collateralAmount,address principalToken,uint256 principalAmount,uint16 interestRateBps,uint256 durationSeconds,uint16 maxLtvBps,uint256 nonce,uint256 deadline)`
  - `LendOffer(address lender,address principalToken,uint256 principalAmount,address collateralToken,uint16 collateralRatioBps,uint16 trustedRatioBps,uint16 scoreThreshold,uint16 maxLtvBps,uint16 interestRateBps,uint256 durationSeconds,uint256 nonce,uint256 deadline)`
- Signer's committed asset MUST be ERC20 (`!= address(0)`): borrower's collateral in `LoanRequest`, lender's principal in `LendOffer`. Native ETH on the committed side is rejected.
- Contract is UUPS-upgradeable and already deployed/initialized — all new storage is appended; no existing slot is reordered. `EIP712Upgradeable` uses ERC-7201 namespaced storage (no `__EIP712_init` call required; name/version supplied via `_EIP712Name`/`_EIP712Version` overrides).
- Replay protection: `mapping(bytes32 => bool) consumedSignatures` keyed by the EIP-712 digest; `deadline` timestamp bounds validity; `nonce` provides digest uniqueness.
- Term-validation require-set in `fill*` must match `createLendOffer` exactly (ratio ≥ 100%, trusted ratio rules, `0 < maxLtvBps ≤ 10000`, ratio-implied LTV floor, interest ≤ 100%).
- Solidity: `pragma solidity ^0.8.24`. Package manager is pnpm. Node ≥ 20.
- Postgres identifiers use camelCase quoted columns (match existing migrations); RPC functions are `SECURITY DEFINER`, `search_path = ''`, granted to `service_role` only.
- Money amounts are stored as `text` (uint256), `bigint` in TS DTOs (validated via `@IsBigInt()`), and `.toString()`'d into RPC calls.

---

## File Structure

**Contract (`packages/contracts/`)**
- Modify: `contracts/VouchVault.sol` — add `EIP712Upgradeable`, structs, typehashes, `consumedSignatures`, `hash*`/`fill*`/`cancel*`, events.
- Modify: `test/VouchVault.test.ts` — new `describe('signedOrders')` block.

**Database (`supabase/migrations/`)**
- Create: `<ts>_signed_orders.sql` — enum, two tables, RLS, trigger, RPC functions.

**API (`apps/api/src/`)**
- Create: `loans/dto/create-signed-loan-request.dto.ts`, `loans/dto/create-signed-lend-offer.dto.ts`
- Create: `loans/signed-orders.service.ts` (+ `signed-orders.service.spec.ts`)
- Create: `loans/signed-orders.controller.ts`
- Create: `loans/eip712.ts` — shared domain/types constants + digest/verify helpers (reused by service and testable in isolation).
- Modify: `loans/loans.module.ts` — register controller + service.
- Modify: `loans/loans.service.ts` — add `fillSignedOrder`, `cancelSignedOrder` (listener-facing RPC wrappers).
- Modify: `blockchain-listener/blockchain-listener.service.ts` — subscribe + handle the four new events.

**Frontend (`apps/web/src/`)**
- Create: `lib/wallet/signedOrders.ts` — types, `signLoanRequest`, `signLendOffer`, `fillLoanRequest`, `fillLendOffer`, `cancelSignedLoanRequest`, `cancelSignedLendOffer`, shared `EIP712_DOMAIN_META`.
- Modify: `lib/wallet/vouchVault.ts` — export ABI additions if ABI is inline, else regen.
- Modify: `routes/borrow/+page.svelte`, `routes/lend/+page.svelte`, `routes/marketplace/+page.svelte` + `+page.ts`.
- Create/Modify: `src/api/` axios wrapper for the signed-order endpoints.

Each task below ends with an independently testable deliverable.

---

## Task 1: Contract — EIP-712 base + typehashes + storage

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol`
- Test: `packages/contracts/test/VouchVault.test.ts`

**Interfaces:**
- Consumes: existing `createLendOffer` validation, `_checkCollateralValue`, `_createLoanFromOffer`, `_payoutEth`/`_payoutToken`, `_effectiveRatio`.
- Produces:
  - `struct SignedLoanRequest` and `struct SignedLendOffer` (fields exactly per Global Constraints type strings, same order).
  - `mapping(bytes32 => bool) public consumedSignatures;`
  - `function hashLoanRequest(SignedLoanRequest calldata req) public view returns (bytes32)`
  - `function hashLendOffer(SignedLendOffer calldata offer) public view returns (bytes32)`
  - Contract now inherits `EIP712Upgradeable`; `_EIP712Name()` returns `"Vouch"`, `_EIP712Version()` returns `"1"`.

- [ ] **Step 1: Write the failing test**

Add near the end of `test/VouchVault.test.ts`:

```ts
describe('signedOrders', function () {
  const RATIO = 16000, TRUSTED = 0, SCORE_THRESH = 0, LTV = 6500, RATE = 800;
  const DURATION = 30n * 86400n;

  async function deployFixture() {
    const [owner, lender, borrower] = await ethers.getSigners();
    const VouchVault = await ethers.getContractFactory('VouchVault');
    const vault = await upgrades.deployProxy(VouchVault, [owner.address], { kind: 'uups' });
    const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
    const ethFeed = await MockAgg.deploy(8, 3200n * 10n ** 8n);
    await vault.connect(owner).setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress(), 18);
    return { vault, owner, lender, borrower };
  }

  it('hashLoanRequest matches ethers TypedDataEncoder', async function () {
    const { vault, borrower } = await deployFixture();
    const net = await ethers.provider.getNetwork();
    const domain = { name: 'Vouch', version: '1', chainId: net.chainId, verifyingContract: await vault.getAddress() };
    const types = { LoanRequest: [
      { name: 'borrower', type: 'address' }, { name: 'collateralToken', type: 'address' },
      { name: 'collateralAmount', type: 'uint256' }, { name: 'principalToken', type: 'address' },
      { name: 'principalAmount', type: 'uint256' }, { name: 'interestRateBps', type: 'uint16' },
      { name: 'durationSeconds', type: 'uint256' }, { name: 'maxLtvBps', type: 'uint16' },
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
    ]};
    const req = {
      borrower: borrower.address, collateralToken: '0x0000000000000000000000000000000000000001',
      collateralAmount: ethers.parseEther('2'), principalToken: ethers.ZeroAddress,
      principalAmount: ethers.parseEther('1'), interestRateBps: RATE, durationSeconds: DURATION,
      maxLtvBps: LTV, nonce: 7n, deadline: 9999999999n,
    };
    const expected = ethers.TypedDataEncoder.hash(domain, types, req);
    expect(await vault.hashLoanRequest(req)).to.equal(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && npx hardhat test --grep "hashLoanRequest matches"`
Expected: FAIL (compile error / `hashLoanRequest is not a function`).

- [ ] **Step 3: Implement the contract additions**

In `VouchVault.sol`:

1. Add import: `import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";`
2. Add `EIP712Upgradeable` to the inheritance list: `contract VouchVault is Initializable, OwnableUpgradeable, UUPSUpgradeable, EIP712Upgradeable {`
3. Add the two structs (fields in the exact order from Global Constraints).
4. Add storage after `nextLendOfferId`: `mapping(bytes32 => bool) public consumedSignatures;`
5. Add typehash constants:

```solidity
bytes32 private constant LOAN_REQUEST_TYPEHASH = keccak256(
  "LoanRequest(address borrower,address collateralToken,uint256 collateralAmount,address principalToken,uint256 principalAmount,uint16 interestRateBps,uint256 durationSeconds,uint16 maxLtvBps,uint256 nonce,uint256 deadline)"
);
bytes32 private constant LEND_OFFER_TYPEHASH = keccak256(
  "LendOffer(address lender,address principalToken,uint256 principalAmount,address collateralToken,uint16 collateralRatioBps,uint16 trustedRatioBps,uint16 scoreThreshold,uint16 maxLtvBps,uint16 interestRateBps,uint256 durationSeconds,uint256 nonce,uint256 deadline)"
);
```

6. Override the name/version providers (no initializer call needed):

```solidity
function _EIP712Name() internal pure override returns (string memory) { return "Vouch"; }
function _EIP712Version() internal pure override returns (string memory) { return "1"; }
```

7. Add the hash functions:

```solidity
function hashLoanRequest(SignedLoanRequest calldata req) public view returns (bytes32) {
    return _hashTypedDataV4(keccak256(abi.encode(
        LOAN_REQUEST_TYPEHASH, req.borrower, req.collateralToken, req.collateralAmount,
        req.principalToken, req.principalAmount, req.interestRateBps, req.durationSeconds,
        req.maxLtvBps, req.nonce, req.deadline
    )));
}

function hashLendOffer(SignedLendOffer calldata offer) public view returns (bytes32) {
    return _hashTypedDataV4(keccak256(abi.encode(
        LEND_OFFER_TYPEHASH, offer.lender, offer.principalToken, offer.principalAmount,
        offer.collateralToken, offer.collateralRatioBps, offer.trustedRatioBps, offer.scoreThreshold,
        offer.maxLtvBps, offer.interestRateBps, offer.durationSeconds, offer.nonce, offer.deadline
    )));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/contracts && npx hardhat test --grep "hashLoanRequest matches"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): add EIP-712 base and signed-order typehashes"
```

---

## Task 2: Contract — `fillLoanRequest` + `LoanRequestFilled`

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol`
- Test: `packages/contracts/test/VouchVault.test.ts`

**Interfaces:**
- Consumes: `hashLoanRequest`, `consumedSignatures`, `_checkCollateralValue`, `_payoutEth`/`_payoutToken`, `nextLoanId`/`loans` write pattern from `_createLoanFromOffer`.
- Produces:
  - `function fillLoanRequest(SignedLoanRequest calldata req, bytes calldata sig) external payable nonReentrant`
  - `event LoanRequestFilled(uint256 indexed loanId, bytes32 indexed digest, address indexed borrower, address lender, address collateralToken, uint256 collateralAmount, address principalToken, uint256 principalAmount, uint256 timestamp)`
  - Internal helper `_createLoanFromSignedRequest(SignedLoanRequest calldata req, address lender) internal returns (uint256 loanId)`.

- [ ] **Step 1: Write the failing test**

Add inside `describe('signedOrders')`. Uses a WBTC-style ERC20 as collateral, ETH as principal supplied by the lender.

```ts
async function signLoanRequest(vault, signer, req) {
  const net = await ethers.provider.getNetwork();
  const domain = { name: 'Vouch', version: '1', chainId: net.chainId, verifyingContract: await vault.getAddress() };
  const types = { LoanRequest: [
    { name: 'borrower', type: 'address' }, { name: 'collateralToken', type: 'address' },
    { name: 'collateralAmount', type: 'uint256' }, { name: 'principalToken', type: 'address' },
    { name: 'principalAmount', type: 'uint256' }, { name: 'interestRateBps', type: 'uint16' },
    { name: 'durationSeconds', type: 'uint256' }, { name: 'maxLtvBps', type: 'uint16' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ]};
  return signer.signTypedData(domain, types, req);
}

it('fillLoanRequest: lender fills ERC20-collateral / ETH-principal request', async function () {
  const { vault, owner, lender, borrower } = await deployFixture();
  // Collateral token = mock WBTC at $64000, 8 decimals
  const Mock = await ethers.getContractFactory('MockERC20');
  const wbtc = await Mock.deploy('WBTC', 'WBTC', 8, 0);
  const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
  const wbtcFeed = await MockAgg.deploy(8, 64000n * 10n ** 8n);
  await vault.connect(owner).setPriceFeed(await wbtc.getAddress(), await wbtcFeed.getAddress(), 8);

  const principal = ethers.parseEther('1'); // $3200
  // need collateral USD >= principal * 1.6 = $5120 -> in WBTC: 5120/64000 = 0.08 WBTC
  const collateral = 8n * 10n ** 6n; // 0.08 WBTC (8 decimals)
  await wbtc.mint(borrower.address, collateral);
  await wbtc.connect(borrower).approve(await vault.getAddress(), collateral);

  const req = {
    borrower: borrower.address, collateralToken: await wbtc.getAddress(),
    collateralAmount: collateral, principalToken: ethers.ZeroAddress,
    principalAmount: principal, interestRateBps: RATE, durationSeconds: DURATION,
    maxLtvBps: LTV, nonce: 1n, deadline: 9999999999n,
  };
  const sig = await signLoanRequest(vault, borrower, req);
  const digest = await vault.hashLoanRequest(req);

  await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: principal }))
    .to.emit(vault, 'LoanRequestFilled')
    .withArgs(0, digest, borrower.address, lender.address, await wbtc.getAddress(), collateral, ethers.ZeroAddress, principal, anyValue);

  const loan = await vault.loans(0);
  expect(loan.borrower).to.equal(borrower.address);
  expect(loan.lender).to.equal(lender.address);
  expect(await vault.consumedSignatures(digest)).to.equal(true);
});

it('fillLoanRequest: reverts on wrong signer', async function () {
  const { vault, lender, borrower, owner } = await deployFixture();
  const req = {
    borrower: borrower.address, collateralToken: '0x0000000000000000000000000000000000000001',
    collateralAmount: 1n, principalToken: ethers.ZeroAddress, principalAmount: 1n,
    interestRateBps: RATE, durationSeconds: DURATION, maxLtvBps: LTV, nonce: 1n, deadline: 9999999999n,
  };
  const sig = await signLoanRequest(vault, owner, req); // wrong signer
  await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: 1n }))
    .to.be.revertedWith('Invalid signature');
});

it('fillLoanRequest: reverts when already consumed', async function () {
  const { vault, owner, lender, borrower } = await deployFixture();
  const Mock = await ethers.getContractFactory('MockERC20');
  const wbtc = await Mock.deploy('WBTC', 'WBTC', 8, 0);
  const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
  const wbtcFeed = await MockAgg.deploy(8, 64000n * 10n ** 8n);
  await vault.connect(owner).setPriceFeed(await wbtc.getAddress(), await wbtcFeed.getAddress(), 8);
  const principal = ethers.parseEther('1');
  const collateral = 8n * 10n ** 6n;
  await wbtc.mint(borrower.address, collateral * 2n);
  await wbtc.connect(borrower).approve(await vault.getAddress(), collateral * 2n);
  const req = {
    borrower: borrower.address, collateralToken: await wbtc.getAddress(), collateralAmount: collateral,
    principalToken: ethers.ZeroAddress, principalAmount: principal, interestRateBps: RATE,
    durationSeconds: DURATION, maxLtvBps: LTV, nonce: 1n, deadline: 9999999999n,
  };
  const sig = await signLoanRequest(vault, borrower, req);
  await vault.connect(lender).fillLoanRequest(req, sig, { value: principal });
  await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: principal }))
    .to.be.revertedWith('Signature already used');
});

it('fillLoanRequest: reverts on ETH collateral (address(0))', async function () {
  const { vault, lender, borrower } = await deployFixture();
  const req = {
    borrower: borrower.address, collateralToken: ethers.ZeroAddress, collateralAmount: 1n,
    principalToken: ethers.ZeroAddress, principalAmount: 1n, interestRateBps: RATE,
    durationSeconds: DURATION, maxLtvBps: LTV, nonce: 1n, deadline: 9999999999n,
  };
  const sig = await signLoanRequest(vault, borrower, req);
  await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: 1n }))
    .to.be.revertedWith('Collateral must be ERC20');
});
```

Add `import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';` at the top of the test file if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && npx hardhat test --grep "fillLoanRequest"`
Expected: FAIL (`fillLoanRequest is not a function`).

- [ ] **Step 3: Implement `fillLoanRequest`**

Add the event near the other events, and this function + helper:

```solidity
event LoanRequestFilled(
    uint256 indexed loanId, bytes32 indexed digest, address indexed borrower, address lender,
    address collateralToken, uint256 collateralAmount, address principalToken, uint256 principalAmount, uint256 timestamp
);

function fillLoanRequest(SignedLoanRequest calldata req, bytes calldata sig) external payable nonReentrant {
    require(req.collateralToken != address(0), "Collateral must be ERC20");
    require(req.collateralAmount > 0, "Collateral must be > 0");
    require(req.maxLtvBps > 0 && req.maxLtvBps <= 10000, "Invalid maxLtvBps");
    require(req.interestRateBps <= 10000, "Interest rate cannot exceed 100%");
    require(block.timestamp <= req.deadline, "Request expired");

    bytes32 digest = hashLoanRequest(req);
    require(!consumedSignatures[digest], "Signature already used");
    require(ECDSA.recover(digest, sig) == req.borrower, "Invalid signature");

    consumedSignatures[digest] = true;

    // Pull ERC20 collateral from borrower (fee-on-transfer guard, matching existing pattern).
    uint256 balBefore = IERC20(req.collateralToken).balanceOf(address(this));
    IERC20(req.collateralToken).safeTransferFrom(req.borrower, address(this), req.collateralAmount);
    uint256 received = IERC20(req.collateralToken).balanceOf(address(this)) - balBefore;
    require(received == req.collateralAmount, "Fee-on-transfer collateral not supported");

    _checkCollateralValueRaw(req.principalToken, req.principalAmount, req.collateralToken, req.collateralAmount, req.maxLtvBps);

    uint256 loanId = _createLoanFromSignedRequest(req, msg.sender);

    // Lender (msg.sender) supplies principal to borrower.
    if (req.principalToken == address(0)) {
        require(msg.value == req.principalAmount, "Incorrect ETH principal");
        _payoutEth(req.borrower, req.principalAmount);
    } else {
        require(msg.value == 0, "Unexpected ETH");
        uint256 pBefore = IERC20(req.principalToken).balanceOf(address(this));
        IERC20(req.principalToken).safeTransferFrom(msg.sender, address(this), req.principalAmount);
        require(IERC20(req.principalToken).balanceOf(address(this)) - pBefore == req.principalAmount, "Fee-on-transfer principal not supported");
        _payoutToken(req.principalToken, req.borrower, req.principalAmount);
    }

    emit LoanRequestFilled(loanId, digest, req.borrower, msg.sender, req.collateralToken, req.collateralAmount, req.principalToken, req.principalAmount, block.timestamp);
}
```

Note: the existing `_checkCollateralValue` takes a `LendOffer storage`. Add a small ratio-agnostic sibling `_checkCollateralValueRaw(address principalToken, uint256 principalAmount, address collateralToken, uint256 collateralAmount, uint16 ratioBps)` that inlines the USD math from `_minCollateralUsd`/`_checkCollateralValue` (they already exist — extract the arithmetic so both call sites share it). Here the "ratio" used for a direct request is `maxLtvBps`-implied; use the same convention the design specifies (`liquidationThresholdBps = maxLtvBps`) and require `collateralUsd >= principalUsd * 10000 / maxLtvBps`.

Then `_createLoanFromSignedRequest` mirrors `_createLoanFromOffer` but reads from `req` (borrower = req.borrower, lender = passed-in, `requestedPrincipalToken/Amount = principalToken/principalAmount`, `interestRateBps = req.interestRateBps`, `durationSeconds = req.durationSeconds`, `liquidationThresholdBps = req.maxLtvBps`, `lendOfferId = 0`). Set `collateralLocked = true`, `funded = true`, timestamps = `block.timestamp`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/contracts && npx hardhat test --grep "fillLoanRequest"`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): add fillLoanRequest with EIP-712 verification"
```

---

## Task 3: Contract — `fillLendOffer` + `LendOfferFilled`

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol`
- Test: `packages/contracts/test/VouchVault.test.ts`

**Interfaces:**
- Consumes: `hashLendOffer`, `consumedSignatures`, existing `_effectiveRatio`/`_checkCollateralValue` (score attestation logic), `_createLoanFromOffer`-style loan creation.
- Produces:
  - `function fillLendOffer(SignedLendOffer calldata offer, bytes calldata sig) external payable nonReentrant`
  - `event LendOfferFilled(uint256 indexed loanId, bytes32 indexed digest, address indexed lender, address borrower, address principalToken, uint256 principalAmount, address collateralToken, uint256 collateralAmount, uint256 timestamp)`
  - Internal helper `_createLoanFromSignedOffer(SignedLendOffer calldata offer, address borrower, address collateralToken, uint256 collateralAmount) internal returns (uint256 loanId)`.

- [ ] **Step 1: Write the failing test**

Add a `signLendOffer` helper (mirrors `signLoanRequest` with the `LendOffer` type array from Global Constraints) and:

```ts
it('fillLendOffer: borrower fills ERC20-principal / ETH-collateral offer', async function () {
  const { vault, owner, lender, borrower } = await deployFixture();
  const Mock = await ethers.getContractFactory('MockERC20');
  const usdc = await Mock.deploy('USDC', 'USDC', 6, 0);
  const MockAgg = await ethers.getContractFactory('MockV3Aggregator');
  const usdcFeed = await MockAgg.deploy(8, 1n * 10n ** 8n); // $1
  await vault.connect(owner).setPriceFeed(await usdc.getAddress(), await usdcFeed.getAddress(), 6);

  const principal = 3200n * 10n ** 6n; // 3200 USDC = $3200
  await usdc.mint(lender.address, principal);
  await usdc.connect(lender).approve(await vault.getAddress(), principal);

  // ETH collateral supplied by borrower; ratio 160% -> need $5120 -> 1.6 ETH at $3200
  const collateral = ethers.parseEther('1.6');
  const offer = {
    lender: lender.address, principalToken: await usdc.getAddress(), principalAmount: principal,
    collateralToken: ethers.ZeroAddress, collateralRatioBps: RATIO, trustedRatioBps: TRUSTED,
    scoreThreshold: SCORE_THRESH, maxLtvBps: LTV, interestRateBps: RATE, durationSeconds: DURATION,
    nonce: 1n, deadline: 9999999999n,
  };
  const sig = await signLendOffer(vault, lender, offer);
  const digest = await vault.hashLendOffer(offer);

  await expect(vault.connect(borrower).fillLendOffer(offer, sig, { value: collateral }))
    .to.emit(vault, 'LendOfferFilled')
    .withArgs(0, digest, lender.address, borrower.address, await usdc.getAddress(), principal, ethers.ZeroAddress, collateral, anyValue);

  const loan = await vault.loans(0);
  expect(loan.lender).to.equal(lender.address);
  expect(loan.borrower).to.equal(borrower.address);
  expect(await vault.consumedSignatures(digest)).to.equal(true);
});

it('fillLendOffer: reverts on ETH principal (address(0))', async function () {
  const { vault, lender, borrower } = await deployFixture();
  const offer = {
    lender: lender.address, principalToken: ethers.ZeroAddress, principalAmount: 1n,
    collateralToken: ethers.ZeroAddress, collateralRatioBps: RATIO, trustedRatioBps: TRUSTED,
    scoreThreshold: SCORE_THRESH, maxLtvBps: LTV, interestRateBps: RATE, durationSeconds: DURATION,
    nonce: 1n, deadline: 9999999999n,
  };
  const sig = await signLendOffer(vault, lender, offer);
  await expect(vault.connect(borrower).fillLendOffer(offer, sig, { value: 1n }))
    .to.be.revertedWith('Principal must be ERC20');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && npx hardhat test --grep "fillLendOffer"`
Expected: FAIL.

- [ ] **Step 3: Implement `fillLendOffer`**

```solidity
event LendOfferFilled(
    uint256 indexed loanId, bytes32 indexed digest, address indexed lender, address borrower,
    address principalToken, uint256 principalAmount, address collateralToken, uint256 collateralAmount, uint256 timestamp
);

function fillLendOffer(SignedLendOffer calldata offer, bytes calldata sig) external payable nonReentrant {
    require(offer.principalToken != address(0), "Principal must be ERC20");
    require(offer.principalAmount > 0, "Principal must be > 0");
    require(offer.collateralRatioBps >= 10000, "Collateral ratio must be >= 100%");
    require(offer.trustedRatioBps == 0 || (offer.trustedRatioBps >= 10000 && offer.trustedRatioBps <= offer.collateralRatioBps), "Invalid trustedRatioBps");
    require(offer.maxLtvBps > 0 && offer.maxLtvBps <= 10000, "Invalid maxLtvBps");
    require(offer.interestRateBps <= 10000, "Interest rate cannot exceed 100%");
    require(block.timestamp <= offer.deadline, "Offer expired");

    bytes32 digest = hashLendOffer(offer);
    require(!consumedSignatures[digest], "Signature already used");
    require(ECDSA.recover(digest, sig) == offer.lender, "Invalid signature");

    consumedSignatures[digest] = true;

    // Borrower (msg.sender) supplies collateral: ETH via msg.value or ERC20 via approve.
    address collateralToken;
    uint256 collateralAmount;
    if (msg.value > 0) {
        collateralToken = address(0);
        collateralAmount = msg.value;
        lockedEthCollateral[msg.sender] += msg.value;
    } else {
        require(offer.collateralToken != address(0), "Collateral required");
        collateralToken = offer.collateralToken;
        collateralAmount = _pullCollateral(offer.collateralToken, msg.sender); // amount signalled off-chain; see note
    }

    // Effective ratio using existing score-attestation logic would require score args;
    // signed offers fill without an attestation, so use the base collateralRatioBps.
    _checkCollateralValueRaw(offer.principalToken, offer.principalAmount, collateralToken, collateralAmount, offer.collateralRatioBps);

    // Pull ERC20 principal from lender, disburse to borrower.
    uint256 pBefore = IERC20(offer.principalToken).balanceOf(address(this));
    IERC20(offer.principalToken).safeTransferFrom(offer.lender, address(this), offer.principalAmount);
    require(IERC20(offer.principalToken).balanceOf(address(this)) - pBefore == offer.principalAmount, "Fee-on-transfer principal not supported");

    uint256 loanId = _createLoanFromSignedOffer(offer, msg.sender, collateralToken, collateralAmount);
    _payoutToken(offer.principalToken, msg.sender, offer.principalAmount);

    emit LendOfferFilled(loanId, digest, offer.lender, msg.sender, offer.principalToken, offer.principalAmount, collateralToken, collateralAmount, block.timestamp);
}
```

**Design note for the implementer:** the ETH-collateral case reads `collateralAmount` from `msg.value`, but the ERC20-collateral case needs an explicit amount. Rather than a separate `_pullCollateral` guess, pass the borrower's collateral amount as a function argument. **Adjust the signature to** `fillLendOffer(SignedLendOffer calldata offer, uint256 collateralAmount, bytes calldata sig)` and: for ETH use `msg.value` (require `collateralAmount == 0` or ignore), for ERC20 use the passed `collateralAmount` with the fee-on-transfer balance-delta guard used elsewhere. Update the Task 3 tests to pass `collateralAmount` accordingly (ETH test passes `0`, and add an ERC20-collateral test passing the amount). Keep `offer.collateralToken` as the *allowed* collateral token the lender signed; require the borrower's supplied token matches it (or is ETH only if `offer.collateralToken == address(0)`).

Implement `_createLoanFromSignedOffer` mirroring `_createLoanFromOffer` (lender = offer.lender, borrower = passed-in, principal from offer, `liquidationThresholdBps = offer.maxLtvBps`, `lendOfferId = 0`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/contracts && npx hardhat test --grep "fillLendOffer"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): add fillLendOffer with EIP-712 verification"
```

---

## Task 4: Contract — cancel functions + events

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.sol`
- Test: `packages/contracts/test/VouchVault.test.ts`

**Interfaces:**
- Produces:
  - `function cancelSignedLoanRequest(SignedLoanRequest calldata req) external`
  - `function cancelSignedLendOffer(SignedLendOffer calldata offer) external`
  - `event LoanRequestCancelled(bytes32 indexed digest, address indexed borrower)`
  - `event LendOfferCancelled(bytes32 indexed digest, address indexed lender)`

- [ ] **Step 1: Write the failing test**

```ts
it('cancelSignedLoanRequest: borrower cancels, then fill reverts', async function () {
  const { vault, lender, borrower } = await deployFixture();
  const req = {
    borrower: borrower.address, collateralToken: '0x0000000000000000000000000000000000000001',
    collateralAmount: 1n, principalToken: ethers.ZeroAddress, principalAmount: 1n,
    interestRateBps: RATE, durationSeconds: DURATION, maxLtvBps: LTV, nonce: 1n, deadline: 9999999999n,
  };
  const digest = await vault.hashLoanRequest(req);
  await expect(vault.connect(borrower).cancelSignedLoanRequest(req))
    .to.emit(vault, 'LoanRequestCancelled').withArgs(digest, borrower.address);
  const sig = await signLoanRequest(vault, borrower, req);
  await expect(vault.connect(lender).fillLoanRequest(req, sig, { value: 1n }))
    .to.be.revertedWith('Signature already used');
});

it('cancelSignedLoanRequest: reverts if caller is not borrower', async function () {
  const { vault, lender, borrower } = await deployFixture();
  const req = {
    borrower: borrower.address, collateralToken: '0x0000000000000000000000000000000000000001',
    collateralAmount: 1n, principalToken: ethers.ZeroAddress, principalAmount: 1n,
    interestRateBps: RATE, durationSeconds: DURATION, maxLtvBps: LTV, nonce: 1n, deadline: 9999999999n,
  };
  await expect(vault.connect(lender).cancelSignedLoanRequest(req)).to.be.revertedWith('Not signer');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && npx hardhat test --grep "cancelSigned"`
Expected: FAIL.

- [ ] **Step 3: Implement cancels**

```solidity
event LoanRequestCancelled(bytes32 indexed digest, address indexed borrower);
event LendOfferCancelled(bytes32 indexed digest, address indexed lender);

function cancelSignedLoanRequest(SignedLoanRequest calldata req) external {
    require(msg.sender == req.borrower, "Not signer");
    bytes32 digest = hashLoanRequest(req);
    require(!consumedSignatures[digest], "Signature already used");
    consumedSignatures[digest] = true;
    emit LoanRequestCancelled(digest, req.borrower);
}

function cancelSignedLendOffer(SignedLendOffer calldata offer) external {
    require(msg.sender == offer.lender, "Not signer");
    bytes32 digest = hashLendOffer(offer);
    require(!consumedSignatures[digest], "Signature already used");
    consumedSignatures[digest] = true;
    emit LendOfferCancelled(digest, offer.lender);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/contracts && npx hardhat test --grep "cancelSigned"`
Expected: PASS.

- [ ] **Step 5: Run the full contract suite + commit**

```bash
cd packages/contracts && npx hardhat test
git add packages/contracts/contracts/VouchVault.sol packages/contracts/test/VouchVault.test.ts
git commit -m "feat(contracts): add signed-order cancellation"
```

---

## Task 5: Database — migration for signed orders

**Files:**
- Create: `supabase/migrations/<ts>_signed_orders.sql` (generate the timestamp with `pnpm db:generate` naming, or copy the `YYYYMMDDHHMMSS` format of the newest existing migration + 1).

**Interfaces:**
- Produces (SQL objects consumed by Tasks 6–7):
  - Enum `"signedOrderStatus" AS ENUM ('open','filled','cancelled','expired')`
  - Tables `signed_loan_requests`, `signed_lend_offers` (columns per spec).
  - RPC `insert_signed_loan_request(...)`, `insert_signed_lend_offer(...)`, `fill_signed_order_with_transaction(...)`, `cancel_signed_order(p_network_id text, p_contract_address address, p_digest text, ...)`.

- [ ] **Step 1: Write the migration**

Model directly on `supabase/migrations/20260818000000_lend_offers.sql`. Enum + tables:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signedOrderStatus') THEN
    CREATE TYPE "signedOrderStatus" AS ENUM ('open','filled','cancelled','expired');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS signed_loan_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest text NOT NULL,
  "chainId" uuid NOT NULL REFERENCES chains (id),
  "borrowerAddress" address NOT NULL,
  "collateralTokenId" uuid NOT NULL REFERENCES tokens (id),
  "collateralAmount" text NOT NULL,
  "principalTokenId" uuid NOT NULL REFERENCES tokens (id),
  "principalAmount" text NOT NULL,
  "interestRateBps" integer NOT NULL,
  duration interval NOT NULL,
  "maxLtvBps" integer NOT NULL,
  nonce text NOT NULL,
  deadline timestamptz NOT NULL,
  signature text NOT NULL,
  status "signedOrderStatus" NOT NULL DEFAULT 'open',
  "filledLoanId" uuid REFERENCES loans (id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS signed_loan_requests_digest_unique ON signed_loan_requests (digest);
CREATE INDEX IF NOT EXISTS signed_loan_requests_borrower_idx ON signed_loan_requests ("borrowerAddress");
CREATE INDEX IF NOT EXISTS signed_loan_requests_status_deadline_idx ON signed_loan_requests (status, deadline);
CREATE TRIGGER update_signed_loan_requests_updated_at BEFORE UPDATE ON signed_loan_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column ();
ALTER TABLE signed_loan_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signed_loan_requests_public_read" ON public.signed_loan_requests FOR SELECT TO anon, authenticated USING (TRUE);
```

Repeat for `signed_lend_offers` with columns: `"lenderAddress"`, `"principalTokenId"`, `"principalAmount"`, `"collateralTokenId"` (nullable — ETH allowed as filler collateral), `"collateralRatioBps"`, `"trustedRatioBps"`, `"scoreThreshold"`, `"maxLtvBps"`, `"interestRateBps"`, `duration`, `nonce`, `deadline`, `signature`, `status`, `"filledLoanId"`.

Then the four RPC functions, each `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''`, resolving `v_chain_id`/token ids exactly like `create_lend_offer_with_transaction`:
- `insert_signed_loan_request(p_network_id text, p_contract_address address, p_digest text, p_borrower_address address, p_collateral_token_address address, p_collateral_amount text, p_principal_token_address address, p_principal_amount text, p_interest_rate_bps integer, p_duration_seconds integer, p_max_ltv_bps integer, p_nonce text, p_deadline timestamptz, p_signature text)` — `INSERT ... ON CONFLICT (digest) DO NOTHING`.
- `insert_signed_lend_offer(...)` — analogous with the offer columns.
- `fill_signed_order_with_transaction(...)` — copy the body of `accept_lend_offer_with_transaction`, but resolve the order by `digest`, set its `status='filled'` and `"filledLoanId"`, and insert the `loans` row + `collateral_deposit`/`loan_disbursement` transactions. Accept a `p_order_kind text` param (`'request'` or `'offer'`) to pick which table to update. Pull loan terms (interest/duration/lender or borrower) from the resolved order row.
- `cancel_signed_order(p_network_id text, p_contract_address address, p_digest text)` — `UPDATE ... SET status='cancelled' WHERE digest=p_digest AND status='open'` on whichever table has the digest (run both UPDATEs; only one matches).

For each function add the matching `REVOKE ALL ... FROM PUBLIC;` and `GRANT EXECUTE ... TO service_role;` blocks (copy the exact signature list, as the existing migration does).

- [ ] **Step 2: Apply and verify the migration**

Run: `npx supabase db reset`
Expected: completes with no error; `signed_loan_requests` and `signed_lend_offers` exist.

Verify: `psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "\d signed_loan_requests"` shows the columns.

- [ ] **Step 3: Regenerate DB types**

Run: `pnpm db:generate:types`
Expected: `packages/database-types/src/generated.ts` updated with the new tables; package rebuilds.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_signed_orders.sql packages/database-types/src/generated.ts
git commit -m "feat(db): signed_loan_requests and signed_lend_offers tables + RPCs"
```

---

## Task 6: API — EIP-712 helper + DTOs

**Files:**
- Create: `apps/api/src/loans/eip712.ts`
- Create: `apps/api/src/loans/dto/create-signed-loan-request.dto.ts`
- Create: `apps/api/src/loans/dto/create-signed-lend-offer.dto.ts`
- Test: `apps/api/src/loans/eip712.spec.ts`

**Interfaces:**
- Produces:
  - `eip712.ts`: `buildDomain(chainId: bigint, verifyingContract: string)`, `LOAN_REQUEST_TYPES`, `LEND_OFFER_TYPES`, `verifyLoanRequest(value, signature, domain): { valid: boolean; signer: string; digest: string }`, `verifyLendOffer(...)`.
  - `CreateSignedLoanRequestDto`, `CreateSignedLendOfferDto` (fields mirror the struct + `networkId`, `contractAddress`, `signature`, `chainId` bigint).

- [ ] **Step 1: Write the failing test**

```ts
import { ethers } from 'ethers';
import { buildDomain, LOAN_REQUEST_TYPES, verifyLoanRequest } from './eip712';

describe('eip712', () => {
  it('verifyLoanRequest recovers the signer', async () => {
    const wallet = ethers.Wallet.createRandom();
    const domain = buildDomain(31337n, '0x1111111111111111111111111111111111111111');
    const value = {
      borrower: wallet.address, collateralToken: '0x0000000000000000000000000000000000000002',
      collateralAmount: '1000', principalToken: ethers.ZeroAddress, principalAmount: '500',
      interestRateBps: 800, durationSeconds: '2592000', maxLtvBps: 6500, nonce: '1', deadline: '9999999999',
    };
    const signature = await wallet.signTypedData(domain, LOAN_REQUEST_TYPES, value);
    const res = verifyLoanRequest(value, signature, domain);
    expect(res.valid).toBe(true);
    expect(res.signer.toLowerCase()).toBe(wallet.address.toLowerCase());
    expect(res.digest).toBe(ethers.TypedDataEncoder.hash(domain, LOAN_REQUEST_TYPES, value));
  });

  it('verifyLoanRequest rejects a tampered value', async () => {
    const wallet = ethers.Wallet.createRandom();
    const domain = buildDomain(31337n, '0x1111111111111111111111111111111111111111');
    const value = { borrower: wallet.address, collateralToken: '0x0000000000000000000000000000000000000002',
      collateralAmount: '1000', principalToken: ethers.ZeroAddress, principalAmount: '500',
      interestRateBps: 800, durationSeconds: '2592000', maxLtvBps: 6500, nonce: '1', deadline: '9999999999' };
    const signature = await wallet.signTypedData(domain, LOAN_REQUEST_TYPES, value);
    const res = verifyLoanRequest({ ...value, principalAmount: '999' }, signature, domain);
    expect(res.signer.toLowerCase()).not.toBe(wallet.address.toLowerCase());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test -- eip712`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `eip712.ts` and DTOs**

```ts
import { ethers } from 'ethers';

export const buildDomain = (chainId: bigint, verifyingContract: string) => ({
  name: 'Vouch', version: '1', chainId, verifyingContract,
});

export const LOAN_REQUEST_TYPES = {
  LoanRequest: [
    { name: 'borrower', type: 'address' }, { name: 'collateralToken', type: 'address' },
    { name: 'collateralAmount', type: 'uint256' }, { name: 'principalToken', type: 'address' },
    { name: 'principalAmount', type: 'uint256' }, { name: 'interestRateBps', type: 'uint16' },
    { name: 'durationSeconds', type: 'uint256' }, { name: 'maxLtvBps', type: 'uint16' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const LEND_OFFER_TYPES = {
  LendOffer: [
    { name: 'lender', type: 'address' }, { name: 'principalToken', type: 'address' },
    { name: 'principalAmount', type: 'uint256' }, { name: 'collateralToken', type: 'address' },
    { name: 'collateralRatioBps', type: 'uint16' }, { name: 'trustedRatioBps', type: 'uint16' },
    { name: 'scoreThreshold', type: 'uint16' }, { name: 'maxLtvBps', type: 'uint16' },
    { name: 'interestRateBps', type: 'uint16' }, { name: 'durationSeconds', type: 'uint256' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ],
} as const;

type Domain = ReturnType<typeof buildDomain>;

const verify = (types: Record<string, unknown>, value: Record<string, unknown>, signature: string, domain: Domain, expectedSignerField: string) => {
  const digest = ethers.TypedDataEncoder.hash(domain, types as never, value);
  let signer = '';
  try { signer = ethers.verifyTypedData(domain, types as never, value, signature); } catch { signer = ''; }
  const valid = !!signer && signer.toLowerCase() === String(value[expectedSignerField]).toLowerCase();
  return { valid, signer, digest };
};

export const verifyLoanRequest = (value: Record<string, unknown>, signature: string, domain: Domain) =>
  verify(LOAN_REQUEST_TYPES as never, value, signature, domain, 'borrower');
export const verifyLendOffer = (value: Record<string, unknown>, signature: string, domain: Domain) =>
  verify(LEND_OFFER_TYPES as never, value, signature, domain, 'lender');
```

DTOs follow `create-lend-offer.dto.ts` conventions. `CreateSignedLoanRequestDto`:

```ts
import { IsNumber, IsNumberString, IsString } from 'class-validator';
import { IsBigInt } from '../../decorators/is-bigint.decorator';

export class CreateSignedLoanRequestDto {
  @IsString() borrowerAddress!: string;
  @IsString() collateralTokenAddress!: string;
  @IsBigInt() collateralAmount!: bigint;
  @IsString() principalTokenAddress!: string;
  @IsBigInt() principalAmount!: bigint;
  @IsNumber() interestRateBps!: number;
  @IsNumber() durationSeconds!: number;
  @IsNumber() maxLtvBps!: number;
  @IsBigInt() nonce!: bigint;
  @IsNumber() deadline!: number;          // unix seconds
  @IsString() signature!: string;
  @IsNumberString() networkId!: string;
  @IsString() contractAddress!: string;
}
```

`CreateSignedLendOfferDto` mirrors with `lenderAddress`, `principalTokenAddress`, `principalAmount`, `collateralTokenAddress`, `collateralRatioBps`, `trustedRatioBps`, `scoreThreshold`, `maxLtvBps`, `interestRateBps`, `durationSeconds`, `nonce`, `deadline`, `signature`, `networkId`, `contractAddress`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test -- eip712`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/eip712.ts apps/api/src/loans/eip712.spec.ts apps/api/src/loans/dto/create-signed-*.dto.ts
git commit -m "feat(api): EIP-712 verification helper and signed-order DTOs"
```

---

## Task 7: API — signed-orders service + controller

**Files:**
- Create: `apps/api/src/loans/signed-orders.service.ts`
- Create: `apps/api/src/loans/signed-orders.service.spec.ts`
- Create: `apps/api/src/loans/signed-orders.controller.ts`
- Modify: `apps/api/src/loans/loans.module.ts`

**Interfaces:**
- Consumes: `SupabaseService`, `verifyLoanRequest`/`verifyLendOffer`/`buildDomain` (Task 6), RPCs `insert_signed_loan_request`/`insert_signed_lend_offer` (Task 5).
- Produces:
  - `SignedOrdersService.createLoanRequest(dto: CreateSignedLoanRequestDto): Promise<{ digest: string }>`
  - `SignedOrdersService.createLendOffer(dto: CreateSignedLendOfferDto): Promise<{ digest: string }>`
  - `SignedOrdersService.listLoanRequests()` / `listLendOffers()` returning open, non-expired rows.
  - `POST /loans/signed-requests`, `POST /loans/signed-offers`, `GET /loans/signed-requests`, `GET /loans/signed-offers`.

- [ ] **Step 1: Write the failing test**

```ts
import { Test } from '@nestjs/testing';
import { ethers } from 'ethers';
import { SignedOrdersService } from './signed-orders.service';
import { SupabaseService } from '../supabase/supabase.service';
import { buildDomain, LOAN_REQUEST_TYPES } from './eip712';

describe('SignedOrdersService', () => {
  const rpc = jest.fn().mockResolvedValue({ error: null });
  const supabase = { client: { rpc } } as unknown as SupabaseService;
  let service: SignedOrdersService;

  beforeEach(async () => {
    rpc.mockClear();
    const mod = await Test.createTestingModule({
      providers: [SignedOrdersService, { provide: SupabaseService, useValue: supabase }],
    }).compile();
    service = mod.get(SignedOrdersService);
  });

  it('rejects a request whose signature does not match borrower', async () => {
    const other = ethers.Wallet.createRandom();
    const dto: any = {
      borrowerAddress: '0x000000000000000000000000000000000000dEaD',
      collateralTokenAddress: '0x0000000000000000000000000000000000000002', collateralAmount: 1000n,
      principalTokenAddress: ethers.ZeroAddress, principalAmount: 500n, interestRateBps: 800,
      durationSeconds: 2592000, maxLtvBps: 6500, nonce: 1n, deadline: 9999999999,
      networkId: '31337', contractAddress: '0x1111111111111111111111111111111111111111',
    };
    const domain = buildDomain(31337n, dto.contractAddress);
    dto.signature = await other.signTypedData(domain, LOAN_REQUEST_TYPES, {
      borrower: dto.borrowerAddress, collateralToken: dto.collateralTokenAddress,
      collateralAmount: dto.collateralAmount.toString(), principalToken: dto.principalTokenAddress,
      principalAmount: dto.principalAmount.toString(), interestRateBps: dto.interestRateBps,
      durationSeconds: dto.durationSeconds.toString(), maxLtvBps: dto.maxLtvBps,
      nonce: dto.nonce.toString(), deadline: dto.deadline.toString(),
    });
    await expect(service.createLoanRequest(dto)).rejects.toThrow(/signature/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stores a valid request via RPC', async () => {
    const wallet = ethers.Wallet.createRandom();
    const dto: any = {
      borrowerAddress: wallet.address, collateralTokenAddress: '0x0000000000000000000000000000000000000002',
      collateralAmount: 1000n, principalTokenAddress: ethers.ZeroAddress, principalAmount: 500n,
      interestRateBps: 800, durationSeconds: 2592000, maxLtvBps: 6500, nonce: 1n, deadline: 9999999999,
      networkId: '31337', contractAddress: '0x1111111111111111111111111111111111111111',
    };
    const domain = buildDomain(31337n, dto.contractAddress);
    dto.signature = await wallet.signTypedData(domain, LOAN_REQUEST_TYPES, {
      borrower: dto.borrowerAddress, collateralToken: dto.collateralTokenAddress,
      collateralAmount: dto.collateralAmount.toString(), principalToken: dto.principalTokenAddress,
      principalAmount: dto.principalAmount.toString(), interestRateBps: dto.interestRateBps,
      durationSeconds: dto.durationSeconds.toString(), maxLtvBps: dto.maxLtvBps,
      nonce: dto.nonce.toString(), deadline: dto.deadline.toString(),
    });
    const res = await service.createLoanRequest(dto);
    expect(res.digest).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(rpc).toHaveBeenCalledWith('insert_signed_loan_request', expect.objectContaining({ p_digest: res.digest }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test -- signed-orders`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement service + controller + module wiring**

`signed-orders.service.ts`: inject `SupabaseService`. In `createLoanRequest`, build the EIP-712 value from the dto (stringify bigints), `buildDomain(BigInt(dto.networkId), dto.contractAddress)`, call `verifyLoanRequest`; if `!valid` throw `BadRequestException('Invalid signature')`; if `dto.deadline * 1000 <= Date.now()` throw `BadRequestException('Request expired')`. Then call `insert_signed_loan_request` RPC with `p_*` params (`asAddress` on addresses, `.toString()` on bigints, `p_duration_seconds: dto.durationSeconds`, `p_deadline: new Date(dto.deadline*1000).toISOString()`, `p_digest: digest`, `p_signature: dto.signature`). Return `{ digest }`. `createLendOffer` is analogous using `verifyLendOffer`. `listLoanRequests`/`listLendOffers` do a `.from('signed_loan_requests').select(...).eq('status','open').gt('deadline', new Date().toISOString())`.

`signed-orders.controller.ts` (pattern from `scoring.controller.ts`):

```ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateSignedLoanRequestDto } from './dto/create-signed-loan-request.dto';
import { CreateSignedLendOfferDto } from './dto/create-signed-lend-offer.dto';
import { SignedOrdersService } from './signed-orders.service';

@Controller('loans')
export class SignedOrdersController {
  constructor(private readonly service: SignedOrdersService) {}

  @Post('signed-requests') createRequest(@Body() dto: CreateSignedLoanRequestDto) { return this.service.createLoanRequest(dto); }
  @Post('signed-offers') createOffer(@Body() dto: CreateSignedLendOfferDto) { return this.service.createLendOffer(dto); }
  @Get('signed-requests') listRequests() { return this.service.listLoanRequests(); }
  @Get('signed-offers') listOffers() { return this.service.listLendOffers(); }
}
```

`loans.module.ts`: add `SignedOrdersService` to `providers`, `SignedOrdersController` to a new `controllers: [...]`, and export `SignedOrdersService`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test -- signed-orders`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/signed-orders.* apps/api/src/loans/loans.module.ts
git commit -m "feat(api): signed-orders service and controller with server-side verification"
```

---

## Task 8: API — listener wrappers for fill/cancel

**Files:**
- Modify: `apps/api/src/loans/loans.service.ts`
- Test: `apps/api/src/loans/loans.service.spec.ts`

**Interfaces:**
- Consumes: RPCs `fill_signed_order_with_transaction`, `cancel_signed_order` (Task 5).
- Produces:
  - `LoansService.fillSignedOrder(dto: FillSignedOrderDto)` where `FillSignedOrderDto` carries `{ orderKind: 'request' | 'offer'; digest; loanId; borrowerAddress; lenderAddress; collateralTokenAddress; collateralAmount; principalTokenAddress; principalAmount; networkId; contractAddress; txHash; blockNumber; blockHash; collateralLogIndex; disbursementLogIndex; filledAt }`.
  - `LoansService.cancelSignedOrder(dto: { digest; networkId; contractAddress; txHash; blockNumber; blockHash; logIndex; cancelledAt })`.
- Create: `apps/api/src/loans/dto/fill-signed-order.dto.ts`, `apps/api/src/loans/dto/cancel-signed-order.dto.ts` (mirror `accept-lend-offer.dto.ts` / `cancel-lend-offer.dto.ts`).

- [ ] **Step 1: Write the failing test**

Extend `loans.service.spec.ts` (follow the existing spec's mock of `supabaseService.client.rpc`):

```ts
it('fillSignedOrder calls fill_signed_order_with_transaction with mapped params', async () => {
  await service.fillSignedOrder({
    orderKind: 'request', digest: '0xabc', loanId: 5n,
    borrowerAddress: '0x00000000000000000000000000000000000000B0',
    lenderAddress: '0x00000000000000000000000000000000000000A0',
    collateralTokenAddress: '0x0000000000000000000000000000000000000002', collateralAmount: 1000n,
    principalTokenAddress: '0x0000000000000000000000000000000000000000', principalAmount: 500n,
    networkId: '31337', contractAddress: '0x1111111111111111111111111111111111111111',
    txHash: '0xtx', blockNumber: 1n, blockHash: '0xbh', collateralLogIndex: 0n, disbursementLogIndex: 1n,
    filledAt: new Date('2026-08-21T00:00:00Z'),
  } as any);
  expect(rpc).toHaveBeenCalledWith('fill_signed_order_with_transaction', expect.objectContaining({
    p_order_kind: 'request', p_digest: '0xabc', p_on_chain_loan_id: '5',
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test -- loans.service`
Expected: FAIL.

- [ ] **Step 3: Implement the wrappers**

Add to `LoansService`, mirroring `acceptLendOffer`/`cancelLendOffer` param mapping (`asAddress`, `.toString()`, `.toISOString()`). Map every DTO field to its `p_*` RPC param. Create the two DTO files.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test -- loans.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/loans.service.ts apps/api/src/loans/loans.service.spec.ts apps/api/src/loans/dto/fill-signed-order.dto.ts apps/api/src/loans/dto/cancel-signed-order.dto.ts
git commit -m "feat(api): loans service wrappers for signed-order fill/cancel"
```

---

## Task 9: Listener — subscribe + handle the four events

**Files:**
- Modify: `apps/api/src/blockchain-listener/blockchain-listener.service.ts`
- Test: `apps/api/src/blockchain-listener/blockchain-listener.service.spec.ts`

**Interfaces:**
- Consumes: `LoansService.fillSignedOrder`, `LoansService.cancelSignedOrder` (Task 8); event args from `LoanRequestFilled`/`LendOfferFilled`/`LoanRequestCancelled`/`LendOfferCancelled` (Tasks 2–4).
- Produces: `handleLoanRequestFilled`, `handleLendOfferFilled`, `handleLoanRequestCancelled`, `handleLendOfferCancelled` + their `contract.on(...)` subscriptions.

- [ ] **Step 1: Write the failing test**

Mirror the existing lend-offer handler test in `blockchain-listener.service.spec.ts`. Assert that invoking `handleLoanRequestFilled(loanId, digest, borrower, lender, collateralToken, collateralAmount, principalToken, principalAmount, timestamp, log, network, contractAddress, contract)` calls `loanService.fillSignedOrder` with `orderKind: 'request'`, the right `digest`, and the collateral/disbursement log-index detection (reuse the Transfer-topic logic already present in `handleLendOfferAccepted`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test -- blockchain-listener`
Expected: FAIL.

- [ ] **Step 3: Implement handlers + subscriptions**

Add four `void contract.on(contract.getEvent('...'), (...args, event) => this.enqueue(queueKey, () => this.handle...(...)))` blocks alongside the existing `LendOfferCreated`/`LendOfferAccepted` subscriptions. Implement the handlers following `handleLendOfferAccepted` (the fill handlers reuse the Transfer-log-index detection; ETH principal/collateral falls back to the event `logIndex`). The cancel handlers call `loanService.cancelSignedOrder({ digest, ... })`. Map `filledAt`/`cancelledAt` from the event's block timestamp or the `timestamp` arg (`new Date(Number(timestamp) * 1000)`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test -- blockchain-listener`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/blockchain-listener/blockchain-listener.service.ts apps/api/src/blockchain-listener/blockchain-listener.service.spec.ts
git commit -m "feat(listener): mirror signed-order fill/cancel events into DB"
```

---

## Task 10: Frontend — signing + fill helpers

**Files:**
- Create: `apps/web/src/lib/wallet/signedOrders.ts`
- Modify: `apps/web/src/lib/wallet/vouchVault.ts` (only if the ABI is inlined here — add the new function/event fragments; otherwise the ABI is regenerated from artifacts).

**Interfaces:**
- Consumes: `getVouchVaultContract`, `isNativeToken`, `ERC20_ABI`, `Token` from `vouchVault.ts`.
- Produces:
  - `EIP712_DOMAIN_META = { name: 'Vouch', version: '1' }` and `LOAN_REQUEST_TYPES`, `LEND_OFFER_TYPES`.
  - `signLoanRequest(req): Promise<{ signature: string; digest: string }>`
  - `signLendOffer(offer): Promise<{ signature: string; digest: string }>`
  - `fillLoanRequest(req, signature): Promise<{ receipt; loanId: bigint }>`
  - `fillLendOffer(offer, collateralAmount, signature): Promise<{ receipt; loanId: bigint }>`
  - `cancelSignedLoanRequest(req)` / `cancelSignedLendOffer(offer)`
  - TS types `SignedLoanRequest`, `SignedLendOffer`.

- [ ] **Step 1: Write the signing/fill helpers**

Follow `vouchVault.ts` conventions (ethers v6, `getVouchVaultContract`, allowance-then-approve pattern from `acceptLendOffer`). Build the domain from `EIP712_DOMAIN_META` + `(await contract.runner.provider.getNetwork()).chainId` + `contract.target`. `signLoanRequest` calls `(contract.runner as ethers.JsonRpcSigner).signTypedData(domain, LOAN_REQUEST_TYPES, req)` and computes `digest = await contract.hashLoanRequest(req)`. `fillLoanRequest` does the collateral `approve` (borrower-side is done at sign time; the filler is the lender who supplies principal — approve the ERC20 principal if `!isNativeToken(principalToken)`, else pass `{ value }`), then `contract.fillLoanRequest(req, signature, overrides)`, parse `LoanRequestFilled` from the receipt (`parsed.args[0]` = loanId). `fillLendOffer` mirrors with borrower supplying collateral (`{ value }` for ETH or approve for ERC20) and passes `collateralAmount`.

- [ ] **Step 2: Type-check**

Run: `cd apps/web && pnpm check`
Expected: no type errors in `signedOrders.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/wallet/signedOrders.ts apps/web/src/lib/wallet/vouchVault.ts
git commit -m "feat(web): EIP-712 signed-order signing and fill helpers"
```

---

## Task 11: Frontend — API client + borrow/lend/marketplace wiring

**Files:**
- Create/Modify: `apps/web/src/api/signedOrders.ts` (axios wrappers: `postSignedRequest`, `postSignedOffer`, `getSignedRequests`, `getSignedOffers`).
- Modify: `apps/web/src/routes/borrow/+page.svelte` (Create gasless request flow).
- Modify: `apps/web/src/routes/lend/+page.svelte` (Create gasless offer flow).
- Modify: `apps/web/src/routes/marketplace/+page.svelte` + `+page.ts` (list + fill signed orders).

**Interfaces:**
- Consumes: `signLoanRequest`/`signLendOffer`/`fillLoanRequest`/`fillLendOffer` (Task 10), the API endpoints (Task 7).

- [ ] **Step 1: Add the axios client**

Follow the existing `src/api/` wrapper style. `postSignedRequest(body)` → `POST /loans/signed-requests`; etc. Serialize bigints to strings in the request body to match the DTO's `@IsBigInt()` expectation on the wire (confirm how existing endpoints send bigints — match that convention).

- [ ] **Step 2: Borrow route — gasless request flow**

Add a "Create gasless request" action: ensure collateral ERC20 `approve` (reuse the existing approval helper), call `signLoanRequest`, then `postSignedRequest`. Surface errors distinctly: user-rejected signature, insufficient allowance, API 400 (validation/expired). Use the existing toast/error components.

- [ ] **Step 3: Lend route — gasless offer flow**

Analogous "Create gasless offer": approve principal ERC20, `signLendOffer`, `postSignedOffer`.

- [ ] **Step 4: Marketplace — list + fill**

In `+page.ts`, additionally fetch `getSignedRequests()` and `getSignedOffers()`. In `+page.svelte`, render them alongside on-chain offers; the fill button calls `fillLoanRequest`/`fillLendOffer` and shows a pending/success/failure state. Reuse the marketplace's existing card/table components.

- [ ] **Step 5: Type-check + manual smoke**

Run: `cd apps/web && pnpm check`
Expected: no type errors.

Manual (documented for the executor, run against `pnpm dev` + local hardhat): sign a request as borrower, confirm it appears in the marketplace, fill it as lender, confirm the loan appears in the dashboard.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/signedOrders.ts apps/web/src/routes/borrow/+page.svelte apps/web/src/routes/lend/+page.svelte apps/web/src/routes/marketplace/
git commit -m "feat(web): gasless signed-order creation and marketplace fill"
```

---

## Task 12: End-to-end verification + docs

**Files:**
- Modify: `packages/contracts/contracts/VouchVault.md` (document the new functions/events).
- Modify: `docs/WALLET_INTEGRATION.md` (document the gasless signing flow).

- [ ] **Step 1: Run all test suites**

```bash
cd packages/contracts && npx hardhat test
cd ../../apps/api && pnpm test
cd ../web && pnpm check
```
Expected: all pass.

- [ ] **Step 2: Document the contract additions**

Add a "Signed Orders (EIP-712)" section to `VouchVault.md` covering the two structs, `hash*`/`fill*`/`cancel*` functions, events, the ERC20-only-committed-asset rule, and the domain (`name`/`version`).

- [ ] **Step 3: Document the frontend flow**

Add a short section to `docs/WALLET_INTEGRATION.md` describing approve → sign → POST → fill, with the domain constants.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/contracts/VouchVault.md docs/WALLET_INTEGRATION.md
git commit -m "docs: document EIP-712 gasless signed orders"
```

---

## Self-Review Notes

- **Spec coverage:** contract structs/verification (Tasks 1–4), DB (Task 5), API store/serve + server-side verification (Tasks 6–7), listener (Tasks 8–9), frontend signing + typings + error reporting (Tasks 10–11), docs (Task 12). All spec sections mapped.
- **Known open detail for the implementer:** Task 3 revises `fillLendOffer`'s signature to accept an explicit `collateralAmount` (documented inline in the design note) — carry that through to Task 8's `collateralAmount`, Task 9's handler args, and Task 10's `fillLendOffer(offer, collateralAmount, signature)`. Keep the three consistent.
- **Score attestation:** signed lend offers fill at the base `collateralRatioBps` (no attestation passed at fill), consistent with the spec's off-chain listing model. If trusted-ratio support for signed offers is desired later, it's an additive change (extra fill args), out of scope here.
