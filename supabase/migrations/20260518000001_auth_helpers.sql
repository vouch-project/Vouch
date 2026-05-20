-- Resolve the wallet address of the caller from the Supabase JWT.
-- The API issues JWTs with a custom `address` claim signed with JWT_SECRET
-- (shared with Supabase), so PostgREST/RLS can read it transparently.
--
-- The claim is returned verbatim — no case-folding. Normalization is
-- chain-type-specific (EIP-55 checksum-cased for EVM, case-preserving for
-- Solana / Bitcoin / etc.) and is the responsibility of the application
-- layer that mints the JWT and writes addresses to the database. As long as
-- both sides normalize identically before write / sign, RLS comparisons
-- line up.
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
