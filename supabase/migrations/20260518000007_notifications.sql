-- In-app notifications. The web client subscribes to changes on this table
-- via Supabase Realtime (see the realtime migration) to render toasts and a
-- notifications inbox in real time.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notificationType') THEN
        CREATE TYPE "notificationType" AS ENUM (
            'loan_funded',
            'loan_repaid',
            'loan_liquidated',
            'loan_due_soon',
            'vouch_received',
            'vouch_revoked',
            'credit_score_updated',
            'system'
        );
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "recipientAddress" address NOT NULL,
    type "notificationType" NOT NULL,
    title text NOT NULL,
    body text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    "loanId" uuid REFERENCES loans (id) ON DELETE CASCADE,
    "readAt" timestamptz,
    "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications ("recipientAddress", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications ("recipientAddress")
WHERE
    "readAt" IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
