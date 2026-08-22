DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'lend_offers'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE lend_offers;
    END IF;
END $$;
