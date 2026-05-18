-- Domain types and shared helpers.
--
-- `address`  : EVM/Solana/etc. account identifier. Stored as text to support
--              every chain we may onboard. Per-chain normalization (e.g.
--              lowercase for EVM, case-preserving base58 for Solana) is the
--              responsibility of the application layer — the database stores
--              addresses verbatim so non-EVM identifiers are not mangled.
-- `uint256`  : Numeric domain large enough to hold any EVM uint256 value.
--
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'address') THEN
        CREATE DOMAIN address AS text;
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'uint256') THEN
        CREATE DOMAIN uint256 AS numeric(78, 0)
            CHECK (VALUE >= 0
                   AND VALUE <= (power(2::numeric, 256) - 1));
    END IF;
END$$;

-- Auto-update `updatedAt` columns when a row actually changes.
CREATE OR REPLACE FUNCTION public.update_updated_at_column () RETURNS TRIGGER SECURITY DEFINER
SET
    search_path = '' LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.* IS DISTINCT FROM OLD.* THEN
        NEW."updatedAt" = now();
    END IF;
    RETURN NEW;
END;
$$;

-- Resolve the wallet address of the caller from the Supabase JWT.
-- The API issues JWTs with a custom `address` claim signed with JWT_SECRET
-- (shared with Supabase), so PostgREST/RLS can read it transparently.
--
-- The claim is returned verbatim — no case-folding. Normalization is
-- chain-type-specific (lowercase for EVM, case-preserving for Solana /
-- Bitcoin / etc.) and is the responsibility of the application layer that
-- mints the JWT and writes addresses to the database. As long as both sides
-- normalize identically before write / sign, RLS comparisons line up.
CREATE OR REPLACE FUNCTION public.current_wallet_address () RETURNS text LANGUAGE sql STABLE
SET
    search_path = '' AS $$
    SELECT nullif(
        coalesce(
            current_setting('request.jwt.claims', true)::jsonb ->> 'address',
            ''
        ),
        ''
    );
$$;

GRANT
EXECUTE ON FUNCTION public.current_wallet_address () TO authenticated,
anon,
service_role;
