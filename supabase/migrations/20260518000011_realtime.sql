-- Expose tables that drive real-time UI updates to the Supabase Realtime
-- publication. Add new tables here as new live-updating UI surfaces appear.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['loans', 'transactions', 'notifications', 'credit_scores'] LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;
