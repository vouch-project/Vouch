-- Enable PostgreSQL extensions used by the platform.
--
-- Per the Supabase linter ("Extension in Public"), user-installable
-- extensions live in a dedicated `extensions` schema rather than `public`.
-- Supabase creates this schema by default and includes it in the role
-- search_path so unqualified references (e.g. `citext`, `gin_trgm_ops`)
-- continue to resolve. We still qualify the operator class explicitly where
-- it appears in CREATE INDEX statements for defensive clarity.
CREATE SCHEMA IF NOT EXISTS extensions;

-- case-insensitive text (handles, emails)
CREATE EXTENSION IF NOT EXISTS "citext"
WITH
    SCHEMA extensions;

-- fuzzy/text-search indexes (handles, addresses)
CREATE EXTENSION IF NOT EXISTS "pg_trgm"
WITH
    SCHEMA extensions;
