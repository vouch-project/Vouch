ALTER TABLE loans
ADD COLUMN IF NOT EXISTS "lendOfferId" uuid REFERENCES lend_offers (id);
