-- audit_log is append-only (CLAUDE.md Hard Rule 8). Triggers apply to every role, including the
-- table owner, so a bug or a compromised API key cannot rewrite history.
CREATE FUNCTION public.audit_log_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_reject_change();
--> statement-breakpoint
-- Defence in depth on Supabase: the browser roles never touch tenant tables (Hard Rule 5).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.audit_log FROM anon, authenticated;
  END IF;
END;
$$;
