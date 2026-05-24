-- Add non-negative CHECK constraints missed in initial migrations
--
-- NOTE: training_dataset constraints live in 20260520000000_training_dataset.sql
-- (the table itself is created there, which runs after this migration).
ALTER TABLE user_credit_features
ADD CONSTRAINT user_credit_features_loans_taken_non_neg CHECK ("totalLoansTaken" >= 0),
ADD CONSTRAINT user_credit_features_loans_repaid_non_neg CHECK ("totalLoansRepaid" >= 0),
ADD CONSTRAINT user_credit_features_loans_defaulted_non_neg CHECK ("totalLoansDefaulted" >= 0);
