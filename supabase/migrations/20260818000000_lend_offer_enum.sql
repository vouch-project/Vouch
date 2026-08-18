DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lendOfferStatus') THEN
        CREATE TYPE "lendOfferStatus" AS ENUM ('pending', 'accepted', 'cancelled', 'expired');
    END IF;
END$$;
