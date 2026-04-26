CREATE OR REPLACE FUNCTION update_updated_at_column () RETURNS TRIGGER SECURITY DEFINER
SET
    search_path = '' AS $$
BEGIN
    IF NEW.* IS DISTINCT FROM OLD.* THEN
        NEW."updatedAt" = now();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
