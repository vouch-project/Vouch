DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['lend_offers', 'signed_loan_requests', 'signed_lend_offers'] LOOP
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
