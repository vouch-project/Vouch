-- Row-Level Security policies.
--
-- Trust model:
--   * `service_role` (used by the NestJS API with the secret key) bypasses
--     RLS entirely and is responsible for all writes.
--   * `anon` + `authenticated` clients (the SvelteKit web app) can SELECT
--     public marketplace data and write only their own profile / metadata.
--   * The web app authenticates via wallet signatures; the API returns a JWT
--     with an `address` claim, which `public.current_wallet_address()` reads.
-- ---------------------------------------------------------------------------
-- Public read access — reference data + marketplace surfaces.
-- ---------------------------------------------------------------------------
CREATE POLICY "chains_public_read" ON public.chains FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

CREATE POLICY "tokens_public_read" ON public.tokens FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

CREATE POLICY "loans_public_read" ON public.loans FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

CREATE POLICY "transactions_public_read" ON public.transactions FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

CREATE POLICY "vouches_public_read" ON public.vouches FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

-- Credit scores: public read of *latest* per address is acceptable for the
-- marketplace UI; raw snapshots are also readable.
CREATE POLICY "credit_scores_public_read" ON public.credit_scores FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

-- ---------------------------------------------------------------------------
-- Users: the base table contains sensitive fields, so reads are limited to
-- the current authenticated user's own row. Public profile browsing should
-- be exposed through a separate sanitized view instead of this table.
-- ---------------------------------------------------------------------------
CREATE POLICY "users_self_read" ON public.users FOR
SELECT
    TO authenticated USING (address = public.current_wallet_address ());

CREATE POLICY "users_self_update" ON public.users
FOR UPDATE
    TO authenticated USING (address = public.current_wallet_address ())
WITH
    CHECK (address = public.current_wallet_address ());

-- ---------------------------------------------------------------------------
-- Notifications: only the recipient may read or mark their own as read.
-- ---------------------------------------------------------------------------
CREATE POLICY "notifications_recipient_read" ON public.notifications FOR
SELECT
    TO authenticated USING (
        "recipientAddress" = public.current_wallet_address ()
    );

CREATE POLICY "notifications_recipient_update" ON public.notifications
FOR UPDATE
    TO authenticated USING (
        "recipientAddress" = public.current_wallet_address ()
    )
WITH
    CHECK (
        "recipientAddress" = public.current_wallet_address ()
    );

-- ---------------------------------------------------------------------------
-- ML feature snapshots: writes are service-only; reads are restricted to the
-- subject (a wallet can see features computed about itself).
-- ---------------------------------------------------------------------------
CREATE POLICY "ml_features_self_read" ON public.ml_feature_snapshots FOR
SELECT
    TO authenticated USING (address = public.current_wallet_address ());

-- ---------------------------------------------------------------------------
-- Operational tables: writable + readable only by the service_role (which
-- bypasses RLS entirely). We attach explicit deny-all policies for anon /
-- authenticated so the Supabase linter doesn't flag the tables for having
-- RLS enabled with no policy. The effect is the same: zero rows visible
-- and zero writes accepted from any non-service caller.
-- ---------------------------------------------------------------------------
CREATE POLICY "blockchain_event_log_deny_all" ON public.blockchain_event_log AS RESTRICTIVE FOR ALL TO anon,
authenticated USING (FALSE)
WITH
    CHECK (FALSE);

CREATE POLICY "analytics_events_deny_all" ON public.analytics_events AS RESTRICTIVE FOR ALL TO anon,
authenticated USING (FALSE)
WITH
    CHECK (FALSE);

-- ---------------------------------------------------------------------------
-- Column-level write privileges.
--
-- RLS only filters *rows*, not *columns*. By default Supabase grants
-- INSERT/UPDATE/DELETE on every `public` table to `authenticated` and
-- `anon`, which would let a wallet that satisfies the `users_self_update`
-- row predicate also rewrite server-managed columns on its own row
-- (`kycStatus`, `emailVerified`, the counters, `reputationScore`, …).
--
-- We revoke the broad grants for these two tables and re-grant UPDATE only
-- on the columns the end-user is allowed to touch directly. INSERTs and
-- DELETEs remain service-only — `ensure_user` and the notification fan-out
-- run as `service_role`, which is unaffected by these revokes.
-- ---------------------------------------------------------------------------
REVOKE INSERT,
UPDATE,
DELETE ON public.users
FROM
    anon,
    authenticated;

REVOKE INSERT,
UPDATE,
DELETE ON public.notifications
FROM
    anon,
    authenticated;

-- Profile fields a user owns: identity bits + free-form preferences bag.
-- Notably excludes `address`, `kycStatus`, `kycProvider`, `kycReference`,
-- `emailVerified`, `reputationScore`, every `total*` counter, `metadata`,
-- and the `*At` timestamps.
GRANT
UPDATE (
    handle,
    "displayName",
    bio,
    "avatarUrl",
    email,
    preferences
) ON public.users TO authenticated;

-- The only thing a recipient is allowed to change on a notification is the
-- read state. Everything else (type, title, body, payload, recipient, …) is
-- written by the service and immutable from the client.
GRANT
UPDATE ("readAt") ON public.notifications TO authenticated;
