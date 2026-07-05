-- Grant table/sequence/function privileges to the Supabase roles.
--
-- Newer Supabase locks down the default privileges for the `postgres` role so
-- that tables created by migrations do NOT automatically expose DML privileges
-- to `anon`, `authenticated`, or `service_role` (they only inherit
-- TRUNCATE/REFERENCES/TRIGGER). Without explicit grants the API's
-- `service_role` client hits `42501 permission denied for table ...` and the
-- web app's `anon`/`authenticated` reads fail even though RLS policies exist.
--
-- Row access is still governed by the RLS policies defined elsewhere:
--   * `service_role` bypasses RLS entirely (trusted API writer).
--   * `anon` / `authenticated` are gated by the public-read + owner-scoped
--     policies; RLS denies by default on any table without a matching policy.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon,
authenticated,
service_role;

-- Existing objects.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

GRANT
SELECT
,
    INSERT,
UPDATE,
DELETE ON ALL TABLES IN SCHEMA public TO anon,
authenticated;

GRANT USAGE,
SELECT
    ON ALL SEQUENCES IN SCHEMA public TO anon,
    authenticated;

-- Deliberately NOT granting EXECUTE on all functions to anon/authenticated:
-- many RPCs are SECURITY DEFINER and intended to be service_role-only (e.g.
-- fund/repay/cancel/expire loan functions REVOKE ALL FROM PUBLIC and GRANT
-- EXECUTE only to service_role). Grant EXECUTE explicitly, per function, in
-- the migration that creates it when it is safe to expose.
-- Future objects created by the role executing this migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT
EXECUTE ON FUNCTIONS TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT
SELECT
,
    INSERT,
UPDATE,
DELETE ON TABLES TO anon,
authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE,
SELECT
    ON SEQUENCES TO anon,
    authenticated;

-- No default EXECUTE grant on functions for anon/authenticated: any function
-- meant to be client-callable must add an explicit GRANT EXECUTE in the
-- migration that creates it.
