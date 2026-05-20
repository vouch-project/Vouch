-- Enforce lowercase on walletAddress columns to prevent the same EVM address
-- stored with different casing producing duplicate rows (UNIQUE is case-sensitive
-- on the `address` text domain). NestJS normalizes to lowercase before writes;
-- this constraint makes that invariant explicit at the DB layer.
ALTER TABLE training_dataset
    ADD CONSTRAINT training_dataset_wallet_lowercase
        CHECK ("walletAddress" = lower("walletAddress"));

ALTER TABLE user_credit_features
    ADD CONSTRAINT user_credit_features_wallet_lowercase
        CHECK ("walletAddress" = lower("walletAddress"));
