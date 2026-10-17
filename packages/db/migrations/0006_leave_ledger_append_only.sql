-- leave_ledger is append-only (CLAUDE.md Hard Rule 10: ledgers over counters). Corrections are
-- new `adjustment` / `reversal` rows, never edits.
CREATE FUNCTION public.leave_ledger_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'leave_ledger is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER leave_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON public.leave_ledger
  FOR EACH ROW EXECUTE FUNCTION public.leave_ledger_reject_change();
--> statement-breakpoint
CREATE TRIGGER leave_ledger_no_truncate
  BEFORE TRUNCATE ON public.leave_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION public.leave_ledger_reject_change();
--> statement-breakpoint
-- Balance per employee / type / year.
CREATE VIEW public.leave_balances_v WITH (security_invoker = true) AS
SELECT employee_id, leave_type_id, period_year, SUM(amount) AS balance
FROM public.leave_ledger
GROUP BY employee_id, leave_type_id, period_year;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.leave_ledger, public.leave_balances_v FROM anon, authenticated;
  END IF;
END;
$$;
