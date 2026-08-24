-- Add 'stale' to signedOrderStatus to distinguish an off-chain balance-shortfall
-- from an on-chain cancellation ('cancelled'). The fill function overwrites status
-- unconditionally so a stale order can still be filled on-chain.
ALTER TYPE "signedOrderStatus" ADD VALUE IF NOT EXISTS 'stale';
