-- user_credit_features_wallet_idx duplicates the index created by the UNIQUE
-- constraint on "walletAddress". Drop the explicit index to avoid double write
-- overhead on every insert/update.
DROP INDEX IF EXISTS user_credit_features_wallet_idx;
