-- Row-Level Security policies.
--
-- Trust model:
--   * `service_role` (used by the NestJS API with the secret key) bypasses
--     RLS entirely and is responsible for all writes.
--   * `anon` + `authenticated` clients (the SvelteKit web app) can SELECT
--     public marketplace data, read their own notifications + ML feature
--     snapshots, and mark their own notifications as read
--     (`notifications.readAt`). No other client-side writes are permitted.
--   * The web app authenticates via wallet signatures; the API returns a JWT
--     with an `address` claim, which `public.current_wallet_address()` reads.
-- ---------------------------------------------------------------------------
-- Public read access — reference data + marketplace surfaces.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Enable read access for all users" ON public.chains;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.tokens;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.loans;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.transactions;

DROP POLICY IF EXISTS "chains_public_read" ON public.chains;

CREATE POLICY "chains_public_read" ON public.chains FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

DROP POLICY IF EXISTS "tokens_public_read" ON public.tokens;

CREATE POLICY "tokens_public_read" ON public.tokens FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

DROP POLICY IF EXISTS "loans_public_read" ON public.loans;

CREATE POLICY "loans_public_read" ON public.loans FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

DROP POLICY IF EXISTS "transactions_public_read" ON public.transactions;

CREATE POLICY "transactions_public_read" ON public.transactions FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

-- Credit scores: public read of *latest* per address is acceptable for the
-- marketplace UI; raw snapshots are also readable.
DROP POLICY IF EXISTS "credit_scores_public_read" ON public.credit_scores;

CREATE POLICY "credit_scores_public_read" ON public.credit_scores FOR
SELECT
    TO anon,
    authenticated USING (TRUE);

-- ---------------------------------------------------------------------------
-- Notifications: only the recipient may read or mark their own as read.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "notifications_recipient_read" ON public.notifications;

CREATE POLICY "notifications_recipient_read" ON public.notifications FOR
SELECT
    TO authenticated USING (
        "recipientAddress" = public.current_wallet_address ()
    );

DROP POLICY IF EXISTS "notifications_recipient_update" ON public.notifications;

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
-- Column-level write privileges.
--
-- RLS only filters *rows*, not *columns*. By default Supabase grants
-- INSERT/UPDATE/DELETE on every `public` table to `authenticated` and
-- `anon`. We revoke the broad grants for notifications and re-grant UPDATE
-- only on the column the end-user is allowed to touch directly. INSERTs and
-- DELETEs remain service-only — the notification fan-out runs as
-- `service_role`, which is unaffected by these revokes.
-- ---------------------------------------------------------------------------
REVOKE INSERT,
UPDATE,
DELETE ON public.notifications
FROM
    anon,
    authenticated;

-- The only thing a recipient is allowed to change on a notification is the
-- read state. Everything else (type, title, body, payload, recipient, …) is
-- written by the service and immutable from the client.
GRANT
UPDATE ("readAt") ON public.notifications TO authenticated;
