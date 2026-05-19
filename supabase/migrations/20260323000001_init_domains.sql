DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'address') THEN
        CREATE DOMAIN address AS text;
    END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'uint256') THEN
    CREATE DOMAIN uint256 AS numeric(78,0)
      CHECK (VALUE >= 0 
             AND VALUE <= (power(2::numeric, 256) - 1));
  END IF;
END$$;
