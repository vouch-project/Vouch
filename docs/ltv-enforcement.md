# LTV Enforcement: Backend-Signed Attestation

## Problem

The credit-score-driven LTV is currently a frontend convention, not an on-chain rule.

`createLoan` / `createLoanWithERC20` accept `liquidationThresholdBps` directly and only
validate `0 < value <= 10000`. A user calling the contract directly (bypassing the frontend)
can pass any LTV they want, ignoring their credit score entirely.

## Solution: Backend-Signed LTV Attestation (EIP-712)

The backend signs a typed message authorizing a maximum LTV for a specific borrower.
The contract verifies the signature before accepting the loan.

### Signed Message Fields

```solidity
struct LtvAttestation {
    address borrower;
    uint16  maxLtvBps;   // credit-score-driven ceiling
    uint256 expiry;      // unix timestamp, short TTL (e.g. 5 minutes)
    uint256 nonce;       // per-borrower nonce to prevent replay
}
```

### Contract Changes

1. Store a `trustedSigner` address (set once by owner, e.g. the backend signing key).
2. Add a `nonces` mapping: `mapping(address => uint256) public nonces`.
3. Add EIP-712 domain separator and `LtvAttestation` type hash.
4. In `createLoan` / `createLoanWithERC20`, add parameters:
   - `uint16 maxLtvBps`
   - `uint256 expiry`
   - `bytes calldata sig`
5. Before creating the loan:
   ```solidity
   require(block.timestamp <= expiry, "Attestation expired");
   require(liquidationThresholdBps <= maxLtvBps, "Exceeds attested LTV");
   bytes32 hash = _hashAttestation(msg.sender, maxLtvBps, expiry, nonces[msg.sender]);
   require(ECDSA.recover(hash, sig) == trustedSigner, "Invalid attestation");
   nonces[msg.sender]++;
   ```

### Backend Changes

When a borrower submits a loan request, the API:
1. Fetches the credit score from the ML engine.
2. Computes `maxLtvBps` using the same `baseLtv × scoreMult` formula as the frontend.
3. Signs the `LtvAttestation` struct with the trusted private key.
4. Returns the signature + `maxLtvBps` + `expiry` to the frontend.
5. Frontend passes all three to `createLoan`.

### Trust Model

The backend signing key becomes a trusted component — consistent with the existing
trust model for the credit score itself. If the key is compromised, an attacker could
issue high-LTV attestations, so the key must be stored securely (e.g. AWS KMS or
equivalent).

### Notes

- Short expiry (5 min) limits replay risk.
- Nonce prevents the same attestation being reused.
- This pattern is identical to EIP-2612 permit signatures — the EIP-712 infrastructure
  from Milestone 5 can be reused.
- Aligns with Phase 2 EIP-712 work already planned.
