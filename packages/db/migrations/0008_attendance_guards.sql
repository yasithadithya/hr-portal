-- Raw punches are evidence (disputes, device audits): append-only. Corrections are new
-- `manual` punches created by an approved regularisation, never edits.
CREATE FUNCTION public.attendance_punches_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'attendance_punches is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER attendance_punches_no_update_delete
  BEFORE UPDATE OR DELETE ON public.attendance_punches
  FOR EACH ROW EXECUTE FUNCTION public.attendance_punches_reject_change();
--> statement-breakpoint
CREATE TRIGGER attendance_punches_no_truncate
  BEFORE TRUNCATE ON public.attendance_punches
  FOR EACH STATEMENT EXECUTE FUNCTION public.attendance_punches_reject_change();
--> statement-breakpoint
-- A locked attendance day is frozen (PLAN.md Phase 6: "locked month cannot change"). The only
-- permitted change is unlocking it (is_locked true -> false), which the API audits.
CREATE FUNCTION public.attendance_days_guard_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_locked THEN
      RAISE EXCEPTION 'attendance day % % is locked', OLD.employee_id, OLD.date USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_locked AND NEW.is_locked THEN
    RAISE EXCEPTION 'attendance day % % is locked', OLD.employee_id, OLD.date USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER attendance_days_locked
  BEFORE UPDATE OR DELETE ON public.attendance_days
  FOR EACH ROW EXECUTE FUNCTION public.attendance_days_guard_locked();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.attendance_punches, public.attendance_days FROM anon, authenticated;
  END IF;
END;
$$;
