-- Add non-negative CHECK constraints missed in initial migrations

ALTER TABLE training_dataset
    ADD CONSTRAINT training_dataset_wallet_age_non_neg CHECK ("walletAgeDays" >= 0),
    ADD CONSTRAINT training_dataset_total_tx_non_neg CHECK ("totalTransactions" >= 0),
    ADD CONSTRAINT training_dataset_liquidation_count_non_neg CHECK ("historicalLiquidationCount" >= 0),
    ADD CONSTRAINT training_dataset_unique_protocols_non_neg CHECK ("uniqueProtocolsUsed" >= 0);

ALTER TABLE user_credit_features
    ADD CONSTRAINT user_credit_features_loans_taken_non_neg CHECK ("totalLoansTaken" >= 0),
    ADD CONSTRAINT user_credit_features_loans_repaid_non_neg CHECK ("totalLoansRepaid" >= 0),
    ADD CONSTRAINT user_credit_features_loans_defaulted_non_neg CHECK ("totalLoansDefaulted" >= 0);
