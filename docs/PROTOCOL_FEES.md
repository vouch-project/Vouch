# Protocol Fees

This document explains how the Vouch protocol fee works, where the fee goes, and how to
change the fee rate and treasury address — both on a local chain and in production.

## Overview

`VouchVault` takes a configurable **protocol fee** out of the **interest** portion of every
loan repayment. Principal and collateral are never touched by the fee — only the interest a
borrower pays on top of principal is taxed.

Two on-chain values control the fee:

| Variable           | Type      | Default        | Meaning                                  |
| ------------------ | --------- | -------------- | ---------------------------------------- |
| `protocolFeeBps`   | `uint256` | `1000` (10%)   | Fee taken from interest, in basis points |
| `protocolTreasury` | `address` | contract owner | Wallet that receives the fee             |

Basis points: `10000 bps = 100%`, so `1000 = 10%`, `500 = 5%`, `50 = 0.5%`.

There is a hard cap: `MAX_PROTOCOL_FEE_BPS = 5000` (50%). `setProtocolFeeBps` reverts above
this value.

## How the fee is calculated

On each repayment the contract splits the payment into a principal portion and an interest
portion, then takes the fee from interest only:

```
interestPortion = paymentAmount - principalDelta
protocolFee     = interestPortion * protocolFeeBps / 10000   // 0 if treasury unset or fee 0
lenderReceives  = paymentAmount - protocolFee
```

The fee is computed at **repayment time** from the live values of `protocolFeeBps` /
`protocolTreasury` — it is _not_ stored per loan. Changing the fee affects all future
repayments immediately, including repayments of loans that already exist.

See `_protocolFee()` in
[`packages/contracts/contracts/VouchVault.sol`](../packages/contracts/contracts/VouchVault.sol):

```solidity
function _protocolFee(uint256 interestPortion) internal view returns (uint256) {
    if (protocolTreasury == address(0) || protocolFeeBps == 0 || interestPortion == 0) {
        return 0;
    }
    return (interestPortion * protocolFeeBps) / 10000;
}
```

## Where the fee goes (fee custody)

The fee is **transferred immediately during the same repayment transaction** — the contract
does not escrow or accumulate fees internally. This is a "push" payment pattern.

- **ERC20 loans** (`repayLoanWithERC20`): the fee is pulled straight from the borrower to the
  treasury via `safeTransferFrom(borrower, protocolTreasury, protocolFee)`, and the lender
  receives `amount - protocolFee`. A `ProtocolFeeCollected` event is emitted.
- **ETH loans** (`repayLoan`): the lender is paid `msg.value - protocolFee` and the treasury
  is paid `protocolFee` via a native `call`. A `ProtocolFeeCollected` event is emitted.

> **Why push and not accumulate-in-contract?** The fee tokens have to leave the borrower
> regardless, so accumulating them in the vault doesn't save a transfer — it just changes the
> destination and adds bookkeeping plus a later withdrawal. The main reason to switch to an
> accumulate-then-withdraw ("pull") pattern would be robustness (a treasury that reverts on
> receive can't brick repayments) rather than gas. Since the treasury is a trusted,
> owner-controlled address, the push pattern is used for simplicity.

### Default treasury

`initialize()` sets `protocolTreasury = initialOwner` and `protocolFeeBps = 1000`. The
deploy script ([`packages/contracts/scripts/deploy.ts`](../packages/contracts/scripts/deploy.ts))
deploys the proxy with `[deployer.address]`, so without extra configuration:

- **On the local hardhat chain** the treasury defaults to the deployer = hardhat **account #0**
  (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`).

> ⚠️ On local, account #0 is also commonly the borrower in test loans, so the fee can land
> back in the same wallet that's borrowing — making it look like nothing left the system.
> Point the treasury at a separate account (e.g. account #3) to see the fee accumulate
> distinctly.

### Configuring treasury & fee at deploy time

The deploy script reads two optional environment variables from the root `.env` and applies
them automatically **after every deploy or upgrade**, so your configuration survives redeploys
instead of resetting to the deployer:

```bash
# root .env
PROTOCOL_TREASURY_ADDRESS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  # account that receives fees
PROTOCOL_FEE_BPS=1000                                                 # 10% (max 5000 = 50%)
```

Behaviour:

- If `PROTOCOL_TREASURY_ADDRESS` is set, the script calls `setProtocolTreasury` (validating the
  address). If unset, the treasury stays as the deployer default.
- If `PROTOCOL_FEE_BPS` is set, the script calls `setProtocolFeeBps` (validating `0 <= bps <= 5000`).
- Calls are **idempotent** — the script skips the transaction when the on-chain value already
  matches, so re-running is cheap.
- In production, the deployer must still own the contract when these run (ownership is typically
  transferred to a multisig afterward — see below).

## Changing the treasury and fee — overview

Both values are changed by calling **owner-only** functions on the already-running proxy. No
redeploy or upgrade is required.

```solidity
function setProtocolTreasury(address newTreasury) external onlyOwner; // reverts on zero address
function setProtocolFeeBps(uint256 newFeeBps)     external onlyOwner; // reverts if > 5000 (50%)
```

The difference between local and production is **only** _who owns the contract_ and _how that
owner signs the transaction_. The on-chain call is identical.

## Changing values locally (development)

Run against your local node from `packages/contracts`. The owner on local is account #0, which
is `signers[0]` by default, so no extra setup is needed.

### Hardhat console (quick, one-off)

```bash
npx hardhat console --network localhost
```

```js
const addr = process.env.PUBLIC_VOUCH_VAULT_ADDRESS; // proxy address from root .env
const v = await ethers.getContractAt('VouchVault', addr);
const signers = await ethers.getSigners();

// change treasury (must be non-zero)
await (await v.setProtocolTreasury(signers[3].address)).wait();

// change fee — basis points, 1000 = 10%, hard-capped at 5000 (50%)
await (await v.setProtocolFeeBps(500)).wait(); // 5%

// verify
console.log(await v.protocolTreasury(), (await v.protocolFeeBps()).toString());
```

> After changing the fee, refresh the web app. The marketplace net-APR display reads
> `protocolFeeBps` on load via `getProtocolFeeBps`, so it only picks up new values on reload.

## Changing values in production

On a real network there is no hardhat console signing transactions for you. You send the exact
same `setProtocolTreasury` / `setProtocolFeeBps` calls to the same proxy address — the
production concerns are **who the owner is** and **how you sign as that owner**.

### 1. Don't leave ownership on a hot EOA

By default ownership belongs to the deployer key. The owner controls **both** the fee/treasury
setters **and** UUPS upgrades (`_authorizeUpgrade`), so it is a high-value target. For mainnet,
transfer ownership to a safer controller right after deploy:

```js
await vault.transferOwnership(MULTISIG_OR_TIMELOCK_ADDRESS);
```

Common production owners:

- **Gnosis Safe multisig** — admin actions require M-of-N signatures. Most common choice.
- **Timelock (+ Governor)** — changes are queued behind a mandatory delay so users can react;
  used by protocols with on-chain governance.

### 2. How the transaction is actually sent

Pick based on the owner type:

- **Gnosis Safe UI** — _New Transaction → Contract interaction_, paste the proxy address + ABI,
  select `setProtocolFeeBps`, enter the value, signers approve, then execute. No code.
- **Etherscan "Write as Proxy"** — for a verified contract, connect the owner wallet (e.g.
  Ledger via MetaMask) and call the function from the browser. Fine for a simple EOA owner.
- **ethers script with a secured signer** — same call, but the signer is a hardware wallet or
  KMS/HSM key pointed at a mainnet/testnet RPC (this is the "not hardhat" path):

  ```js
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = /* Ledger / AWS KMS signer / wallet from secured key */;
  const v = new ethers.Contract(PROXY_ADDRESS, abi, signer);
  await (await v.setProtocolFeeBps(500)).wait();
  ```

- **OpenZeppelin Defender** — create an _Admin_ proposal for the function call, route it to your
  Safe/Timelock for approval, with audit logging. Good for teams and repeatable processes.

## Events

These events are emitted so off-chain services and explorers can track changes:

| Event                                                                                 | When                         |
| ------------------------------------------------------------------------------------- | ---------------------------- |
| `ProtocolTreasuryUpdated(address indexed treasury)`                                   | Treasury address changed     |
| `ProtocolFeeUpdated(uint256 feeBps)`                                                  | Fee rate changed             |
| `ProtocolFeeCollected(uint256 indexed loanId, address indexed token, uint256 amount)` | A fee was taken on repayment |

## Frontend integration

- The store [`apps/web/src/lib/stores/chainInfo.svelte.ts`](../apps/web/src/lib/stores/chainInfo.svelte.ts)
  holds `protocolFeeBps` (default `1000`).
- It is hydrated on load in
  [`apps/web/src/routes/+layout.svelte`](../apps/web/src/routes/+layout.svelte) via
  `getProtocolFeeBps()` from
  [`apps/web/src/lib/wallet/vouchVault.ts`](../apps/web/src/lib/wallet/vouchVault.ts).
- The marketplace
  ([`apps/web/src/routes/marketplace/+page.svelte`](../apps/web/src/routes/marketplace/+page.svelte))
  shows lenders the **net APR** (gross rate minus the protocol fee) so they see what they
  actually earn, not just the headline rate.

## Quick reference

| Task               | Local                                 | Production                                |
| ------------------ | ------------------------------------- | ----------------------------------------- |
| Change fee rate    | `v.setProtocolFeeBps(bps)` in console | Same call via Safe / Etherscan / Defender |
| Change treasury    | `v.setProtocolTreasury(addr)`         | Same call via Safe / Etherscan / Defender |
| Who can call       | account #0 (deployer/owner)           | the owner (multisig / timelock)           |
| Fee cap            | 5000 bps (50%)                        | 5000 bps (50%)                            |
| When changes apply | next repayment                        | next repayment                            |
