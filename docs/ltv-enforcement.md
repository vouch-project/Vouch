# LTV Enforcement: Backend-Signed Attestation

## Problem

The credit-score-driven LTV ceiling is enforced by the frontend, not the contract.

`fillLoanRequest` allows a lender to fill a borrower's EIP-712-signed loan request.
The `maxLtvBps` field is chosen by the borrower at signing time and only validated
as `0 < value <= 10000`. A borrower could sign with `maxLtvBps = 10000`, bypassing
their credit score entirely.

## Solution: Backend-Signed LTV Attestation (EIP-712)

The backend signs a typed message authorising a maximum LTV for a specific borrower
and token pair. The contract verifies the attestation signature inside `fillLoanRequest`
before creating the loan.

### Signed Message Fields

```solidity
struct LtvAttestation {
    address borrower;
    address collateralToken;
    address borrowToken;
    uint16  maxLtvBps;   // credit-score-driven ceiling
    uint256 expiry;      // unix timestamp, short TTL (e.g. 5 minutes)
    uint256 nonce;       // per-borrower nonce to prevent replay
}
```

### Contract Changes (`fillLoanRequest`)

Three parameters added:
- `uint16 attestedMaxLtvBps` — the backend-authorised ceiling
- `uint256 attExpiry` — attestation expiry timestamp
- `bytes calldata attSig` — backend ECDSA signature over the `LtvAttestation` struct

Before creating the loan, the function now:
```solidity
if (req.maxLtvBps > attestedMaxLtvBps) revert LtvExceedsAttestedMax();
// (replay + borrower sig checks run here)
_verifyLtvAttestation(req.borrower, req.collateralToken, req.principalToken,
                      attestedMaxLtvBps, attExpiry, attSig);
```

`_verifyLtvAttestation` hashes the `LtvAttestation` struct via EIP-712, recovers the
signer, and reverts with `InvalidAttestation` if it does not match `scoreSigner`.
It is a no-op when `scoreSigner == address(0)` (local/test environments).

### Frontend Changes

At fill time (lender side, `BorrowTab.svelte`):
1. Calls `GET /scoring/{address}/ltv-attestation` with token pair + chain info.
2. Passes the returned `{ maxLtvBps, expiry, sig }` to `fillLoanRequest`.

### Backend

When a lender requests to fill a loan:
1. Fetches the borrower's credit score from the ML engine.
2. Computes `maxLtvBps` using the `baseLtv × scoreMult` formula.
3. Signs the `LtvAttestation` struct with the trusted private key (`SCORE_SIGNER_PRIVATE_KEY`).
4. Returns `{ maxLtvBps, expiry, sig }`.

### Trust Model

The backend signing key is the trust anchor — consistent with the existing trust model
for the credit score. If the key is compromised, an attacker could issue high-LTV
attestations. The key must be stored securely (e.g. AWS KMS).

Short expiry (5 min) limits replay risk. The per-borrower nonce prevents the same
attestation from being reused across fills.
