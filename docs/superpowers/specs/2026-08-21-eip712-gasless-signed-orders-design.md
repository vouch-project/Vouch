# EIP-712 Gasless Signed Orders (Off-Chain Loan Signatures)

**Issue:** #25 — Implement EIP-712 for Off-Chain Loan Signatures (Gasless Listings)
**Date:** 2026-08-21
**Status:** Approved design, pending implementation plan

## Goal

Enable gasless marketplace listings on both sides of the protocol:

- **Borrowers** sign a `LoanRequest` off-chain (no gas). A **lender** later fills it on-chain.
- **Lenders** sign a `LendOffer` off-chain (no gas). A **borrower** later fills it on-chain.

The signer never sends a transaction to create the listing — only a one-time ERC20
`approve()` for the asset they commit, plus an off-chain EIP-712 signature. The filler
pays gas at settlement, at which point collateral and principal move atomically.

This is the inverse/companion of the existing **on-chain** `LendOffer` flow
(`createLendOffer` → `acceptLendOffer`), which stays untouched.

## Scope & Key Decisions

| Decision                          | Choice                                                             | Rationale                                                                          |
| --------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Both marketplace sides            | Yes — signed `LoanRequest` **and** signed `LendOffer`              | Symmetric UX; shared EIP-712 infra                                                 |
| Signer's committed asset          | **ERC20 only** (one-time `approve`)                                | ETH cannot be pulled from a signature (no `approve`/`transferFrom` for native ETH) |
| Native ETH                        | Stays on the **existing on-chain** path                            | Avoids pre-deposit/WETH complexity for now                                         |
| EIP-712 domain on live UUPS proxy | **Computed in-contract** (override `_EIP712Name`/`_EIP712Version`) | No reinitializer ceremony; safe on already-initialized proxy                       |
| Replay protection                 | **Hash-based consumption + deadline + nonce/salt**                 | Standard order-signature pattern; supports multiple parallel outstanding orders    |
| Stack coverage                    | **Full stack** — contract + DB + API + frontend + listener         | Mirrors existing `lend_offers` architecture                                        |

### The ERC20/ETH asymmetry (important)

The **signer's** committed asset must be an **ERC20** — that is what gets pulled via
`approve()`/`safeTransferFrom` at fill time. The **filler's** asset may be **ETH or
ERC20**, because the filler sends a live transaction and can attach `msg.value`.

- `LoanRequest`: borrower commits **collateral** → collateral must be ERC20. Principal
  (supplied by the lender/filler) may be ETH or ERC20.
- `LendOffer`: lender commits **principal** → principal must be ERC20. Collateral
  (supplied by the borrower/filler) may be ETH or ERC20.

Native-ETH collateral or native-ETH principal on the _committed_ side continues to use
the existing on-chain functions (`createLendOffer` / `acceptLendOffer`).

## Architecture & Flow

```
Signer (gasless per order):
  1. approve(vault, committedAmount)      one-time on-chain, reusable across orders
  2. signTypedData(order)                 off-chain, no gas
  3. POST signed order + signature → API  (API verifies sig, then stores)

Marketplace:
  4. Fillers browse open signed orders (DB read via API)

Filler (pays gas at settlement):
  5. fillLoanRequest(req, sig)  /  fillLendOffer(offer, collateralToken, collateralAmount, sig)   { value or ERC20 }
       → vault verifies EIP-712 sig recovers to the signer
       → vault pulls committed ERC20 from signer (safeTransferFrom)
       → filler supplies their side (msg.value for ETH, or safeTransferFrom for ERC20)
       → vault creates a funded Loan, marks digest consumed
       → emits *Filled event

Listener:
  6. *Filled  → fill_signed_order_with_transaction (create loan + txns, status=filled)
     *Cancelled → cancel_signed_order(digest)
```

Cancellation: signer sends a cheap `cancelSigned*` tx marking the digest consumed.
Expiry: `deadline` field + status check (same as lend-offer expiry path). There is **no
on-chain "created" event** — creation is off-chain via the API POST; the listener only
reacts to fill/cancel.

## Smart Contract (`packages/contracts/contracts/VouchVault.sol`)

### Inheritance & imports

- Add `EIP712Upgradeable` to the inheritance list.
- Override `_EIP712Name()` → `"Vouch"`, `_EIP712Version()` → `"1"` (constants), so the
  domain separator is derived without requiring `__EIP712_init` to have run on the
  already-initialized proxy. `_hashTypedDataV4` falls back to
  `keccak256(bytes(_EIP712Name()))` when the cached hash is empty.
- `ECDSA` and `MessageHashUtils` are already imported.

### Typed structs

```solidity
struct SignedLoanRequest {   // borrower signs; lender fills
    address borrower;
    address collateralToken;   // ERC20, must != address(0)
    uint256 collateralAmount;
    address principalToken;    // ETH (address(0)) or ERC20 — supplied by lender at fill
    uint256 principalAmount;
    uint16  interestRateBps;
    uint256 durationSeconds;
    uint16  maxLtvBps;
    uint256 nonce;             // signer-chosen salt for digest uniqueness
    uint256 deadline;          // fill no longer allowed after this timestamp
}

struct SignedLendOffer {     // lender signs; borrower fills
    address lender;
    address principalToken;    // ERC20, must != address(0)
    uint256 principalAmount;
    // collateralToken is NOT signed — borrower supplies it as a separate fillLendOffer() param
    uint16  collateralRatioBps;
    uint16  trustedRatioBps;
    uint16  scoreThreshold;
    uint16  maxLtvBps;
    uint16  interestRateBps;
    uint256 durationSeconds;
    uint256 nonce;
    uint256 deadline;
}
```

Type strings (used verbatim in `TYPEHASH` and by API/frontend):

```
LoanRequest(address borrower,address collateralToken,uint256 collateralAmount,address principalToken,uint256 principalAmount,uint16 interestRateBps,uint256 durationSeconds,uint16 maxLtvBps,uint256 nonce,uint256 deadline)

LendOffer(address lender,address principalToken,uint256 principalAmount,uint16 collateralRatioBps,uint16 trustedRatioBps,uint16 scoreThreshold,uint16 maxLtvBps,uint16 interestRateBps,uint256 durationSeconds,uint256 nonce,uint256 deadline)
```

### Storage (appended — upgrade-safe)

```solidity
mapping(bytes32 => bool) public consumedSignatures;   // digest => used or cancelled
```

`EIP712Upgradeable` uses ERC-7201 namespaced storage, which cannot collide with the
existing sequential layout. New mapping is appended after existing state. UUPS-safe.

### Functions

- `hashLoanRequest(SignedLoanRequest calldata req) public view returns (bytes32)` —
  `_hashTypedDataV4(keccak256(abi.encode(LOAN_REQUEST_TYPEHASH, ...)))`.
- `hashLendOffer(SignedLendOffer calldata offer) public view returns (bytes32)` — same.
  (Public so API and frontend can recompute identical digests.)
- `fillLoanRequest(SignedLoanRequest calldata req, bytes calldata sig) external payable nonReentrant`
  1. `require(req.collateralToken != address(0))` — ERC20 collateral only.
  2. Term validation reusing the exact require-set from `createLendOffer`
     (ratio/LTV/interest bounds).
  3. `require(block.timestamp <= req.deadline)`.
  4. `digest = hashLoanRequest(req)`; `require(!consumedSignatures[digest])`.
  5. `require(ECDSA.recover(digest, sig) == req.borrower)`.
  6. `consumedSignatures[digest] = true` **before** external calls (checks-effects-
     interactions; `nonReentrant` as defense-in-depth).
  7. Pull collateral: `safeTransferFrom(req.borrower, address(this), req.collateralAmount)`
     with the fee-on-transfer balance-delta check used elsewhere. Enforce collateral value
     via the `_checkCollateralValue`-equivalent against `maxLtvBps`.
  8. Lender (msg.sender) supplies principal: ETH via `msg.value == req.principalAmount`,
     or ERC20 via `safeTransferFrom(msg.sender, ...)`. Disburse to borrower using the
     existing payout pattern (`_payoutEth` / `_payoutToken` / pull-payment credit).
  9. Create funded loan via a helper analogous to `_createLoanFromOffer`
     (`borrower = req.borrower`, `lender = msg.sender`, funded immediately).
  10. `emit LoanRequestFilled(loanId, digest, borrower, lender, collateralToken, collateralAmount, principalToken, principalAmount, timestamp)`.
- `fillLendOffer(SignedLendOffer calldata offer, bytes calldata sig) external payable nonReentrant`
  - Symmetric: `require(offer.principalToken != address(0))`; verify sig recovers to
    `offer.lender`; mark consumed; pull ERC20 principal from lender; borrower (msg.sender)
    supplies collateral (ETH `msg.value` or ERC20); apply the existing
    `_effectiveRatio`/`_checkCollateralValue` score-attestation logic; create funded loan;
    `emit LendOfferFilled(...)`.
- `cancelSignedLoanRequest(SignedLoanRequest calldata req) external` —
  `require(msg.sender == req.borrower)`, compute digest, `require(!consumed)`, mark
  consumed, `emit LoanRequestCancelled(digest, borrower)`.
- `cancelSignedLendOffer(SignedLendOffer calldata offer) external` — symmetric for lender.

### Events

```solidity
event LoanRequestFilled(uint256 indexed loanId, bytes32 indexed digest, address indexed borrower, address lender, address collateralToken, uint256 collateralAmount, address principalToken, uint256 principalAmount, uint256 timestamp);
event LoanRequestCancelled(bytes32 indexed digest, address indexed borrower);
event LendOfferFilled(uint256 indexed loanId, bytes32 indexed digest, address indexed lender, address borrower, address principalToken, uint256 principalAmount, address collateralToken, uint256 collateralAmount, uint256 timestamp);
event LendOfferCancelled(bytes32 indexed digest, address indexed lender);
```

### Hardhat tests

For **both** fill directions:

- Happy path: ERC20 committed side + ETH filler side, and ERC20 + ERC20.
- Revert: signature/​signer mismatch.
- Revert: expired deadline.
- Revert: double-fill (digest already consumed).
- Revert: cancel-then-fill.
- Revert: collateral value below required ratio.
- Revert: `address(0)` on the committed (signer) asset.

## Database (`supabase/migrations/<ts>_signed_orders.sql`)

Follows the `lend_offers` migration pattern. Two tables (fields differ per direction) +
one shared status enum.

```
CREATE TYPE "signedOrderStatus" AS ENUM ('open', 'filled', 'cancelled', 'expired');

signed_loan_requests                       -- borrower-signed
  id uuid PK DEFAULT gen_random_uuid()
  digest              text UNIQUE NOT NULL  -- EIP-712 digest = canonical id
  "chainId"           uuid NOT NULL → chains
  "borrowerAddress"   address NOT NULL
  "collateralTokenId" uuid NOT NULL → tokens   (ERC20)
  "collateralAmount"  text NOT NULL
  "principalTokenId"  uuid NOT NULL → tokens
  "principalAmount"   text NOT NULL
  "interestRateBps"   integer NOT NULL
  duration            interval NOT NULL
  "maxLtvBps"         integer NOT NULL
  nonce               text NOT NULL           -- uint256 as text
  deadline            timestamptz NOT NULL
  signature           text NOT NULL           -- raw 65-byte sig hex
  status              "signedOrderStatus" NOT NULL DEFAULT 'open'
  "filledLoanId"      uuid → loans
  "createdAt"/"updatedAt" timestamptz

signed_lend_offers                         -- lender-signed
  ... same shape, "lenderAddress" instead of borrower, collateral/principal roles kept,
      plus "collateralRatioBps", "trustedRatioBps", "scoreThreshold" ...
```

- Indexes: `UNIQUE(digest)`, `(status, deadline)`, signer-address index.
- RLS: public read policy for rows (marketplace browse), matching `lend_offers_public_read`.
- `updatedAt` trigger reusing `update_updated_at_column`.

### RPC functions (SECURITY DEFINER, `service_role` only)

Mirror the existing `*_with_transaction` functions:

- `insert_signed_loan_request(...)` / `insert_signed_lend_offer(...)` — resolve
  chain/token ids, insert with `status='open'`, `ON CONFLICT (digest) DO NOTHING`.
- `fill_signed_order_with_transaction(...)` — called by the listener on a fill event:
  mark order `filled`, insert the `loans` row + `collateral_deposit` /
  `loan_disbursement` transactions (body mirrors `accept_lend_offer_with_transaction`).
- `cancel_signed_order(p_digest)` / `expire_signed_order(p_digest)` — status flips.

## API (NestJS, `apps/api/src/loans/`)

New `signed-orders.service.ts` (kept separate from the 390-line `loans.service.ts` for
clarity) + DTOs in `apps/api/src/loans/dto/`.

Endpoints:

- `POST /loans/signed-requests` — body validated by `CreateSignedLoanRequestDto`.
  **Server-side signature verification before storing:** recompute the EIP-712 digest
  (`ethers.TypedDataEncoder.hash(domain, types, value)`), call `ethers.verifyTypedData(...)`,
  assert recovered signer === `borrowerAddress` and that the client-supplied digest
  matches; reject `400` on mismatch or expired `deadline`. Then call
  `insert_signed_loan_request`.
- `POST /loans/signed-offers` — same, verifying against `lenderAddress`.
- `GET /loans/signed-requests` / `GET /loans/signed-offers` — list `open`, non-expired
  orders for the marketplace (optional token/chain filters). Returns all fields needed to
  call the on-chain fill, including the stored `signature`.

DTOs follow `create-lend-offer.dto.ts` (`class-validator`, `@IsBigInt()`):
`create-signed-loan-request.dto.ts`, `create-signed-lend-offer.dto.ts`.

**Why server-side verification:** the API is the marketplace gatekeeper. Verifying before
storing prevents forged/garbage listings from polluting the marketplace and wasting
fillers' gas on fills that would revert.

Unit tests mirror `loans.service.lend-offer.spec.ts`, including a
signature-verification-rejection case.

## Frontend (`apps/web`)

New `apps/web/src/lib/wallet/signedOrders.ts`. Uses **ethers.js** (matching existing
`vouchVault.ts`; not wagmi/core despite the issue's suggestion) via
`signer.signTypedData(domain, types, value)`.

```ts
const domain = { name: 'Vouch', version: '1', chainId, verifyingContract: vaultAddress };
```

Functions:

- `signLoanRequest(request)` → `{ signature, digest }` (borrower; requires prior
  collateral `approve()` — reuse the accept flow's approval helper).
- `signLendOffer(offer)` → `{ signature, digest }` (lender; prior principal `approve()`).
- `fillLoanRequest(request, signature)` / `fillLendOffer(offer, signature)` — mirror
  `acceptLendOffer` in `vouchVault.ts`; parse the `*Filled` event from the receipt for
  the on-chain loan id.
- Full TypeScript types for both structs (issue explicitly requests typings).

UI wiring:

- Borrow route: "Create gasless request" — approve (if needed) → sign →
  `POST /loans/signed-requests`. Clear error reporting (rejected signature, insufficient
  allowance, expired, API validation errors).
- Lend route: analogous "Create gasless offer".
- Marketplace (`routes/marketplace`): show open signed orders alongside on-chain offers;
  filler action → `fillLoanRequest` / `fillLendOffer` (pays gas).

The domain (`name`, `version`, `chainId`, `verifyingContract`) must match the contract and
API verifier exactly. Centralize it in one shared constant so contract override, API
`TypedDataEncoder`, and frontend `signTypedData` cannot drift.

## Blockchain Listener (`apps/api/src/blockchain-listener`)

Add handlers following existing `LendOfferAccepted` / `LendOfferCreated` handling:

- `LoanRequestFilled` / `LendOfferFilled` → `fill_signed_order_with_transaction`.
- `LoanRequestCancelled` / `LendOfferCancelled` → `cancel_signed_order(digest)`.

Register new event ABIs/topics in the subscription set. No "created" event exists —
creation is off-chain via the API. Expiry handled by status check (lend-offer parity).

## Shared ABI

Add new functions + events to the vault ABI consumed by both the frontend
(`apps/web/src/lib/wallet/vouchVault.ts`) and the listener, regenerated from the compiled
contract as the repo already does.

## Out of Scope

- Native-ETH on the signer's committed side (requires pre-deposit or WETH — deferred).
- Migrating/deprecating the existing on-chain `createLendOffer` / `acceptLendOffer` flow —
  both paths coexist.
- Partial fills of a signed order (each order is filled once, in full).
