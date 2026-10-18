-- Locked payroll is immutable (PLAN.md Phase 7). Corrections go through an adjustment run in a
-- later period. The only change to a locked run is marking it paid; the only change to its
-- payslips is recording the generated PDF and when it was emailed.
CREATE FUNCTION public.payroll_run_status(run uuid) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT status FROM public.payroll_runs WHERE id = run $$;
--> statement-breakpoint
CREATE FUNCTION public.payroll_runs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'locked', 'paid') THEN
      RAISE EXCEPTION 'payroll run % is %', OLD.id, OLD.status USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('locked', 'paid') THEN
    IF NOT (OLD.status = 'locked' AND NEW.status = 'paid'
            AND NEW.period_id = OLD.period_id AND NEW.type = OLD.type
            AND NEW.totals IS NOT DISTINCT FROM OLD.totals
            AND NEW.config_snapshot IS NOT DISTINCT FROM OLD.config_snapshot) THEN
      RAISE EXCEPTION 'payroll run % is %', OLD.id, OLD.status USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payroll_runs_locked
  BEFORE UPDATE OR DELETE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.payroll_runs_guard();
--> statement-breakpoint
CREATE FUNCTION public.payroll_child_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  st := public.payroll_run_status(CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END);
  IF st IN ('locked', 'paid') THEN
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'payslips'
       AND (to_jsonb(NEW) - 'pdf_path' - 'emailed_at' - 'updated_at' - 'updated_by')
         = (to_jsonb(OLD) - 'pdf_path' - 'emailed_at' - 'updated_at' - 'updated_by') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION '% of a % payroll run cannot change', TG_TABLE_NAME, st USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payslips_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.payslips
  FOR EACH ROW EXECUTE FUNCTION public.payroll_child_guard();
--> statement-breakpoint
CREATE TRIGGER payroll_inputs_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_inputs
  FOR EACH ROW EXECUTE FUNCTION public.payroll_child_guard();
--> statement-breakpoint
CREATE FUNCTION public.payslip_lines_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  SELECT r.status INTO st FROM public.payslips p JOIN public.payroll_runs r ON r.id = p.run_id
  WHERE p.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.payslip_id ELSE NEW.payslip_id END;
  IF st IN ('locked', 'paid') THEN
    RAISE EXCEPTION 'payslip lines of a % payroll run cannot change', st USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payslip_lines_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.payslip_lines
  FOR EACH ROW EXECUTE FUNCTION public.payslip_lines_guard();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.payroll_runs, public.payslips, public.payslip_lines, public.payroll_inputs,
      public.employee_salary, public.loans, public.loan_installments FROM anon, authenticated;
  END IF;
END;
$$;
