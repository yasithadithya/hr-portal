CREATE TABLE "bank_file_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"bank" text NOT NULL,
	"format" text NOT NULL,
	"spec" jsonb NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "bank_file_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "bank_file_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_bank_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"bank_code" text,
	"branch_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "employee_bank_codes_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
ALTER TABLE "employee_bank_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_pay_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "employee_pay_components_range" CHECK ("employee_pay_components"."effective_to" is null or "employee_pay_components"."effective_to" >= "employee_pay_components"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "employee_pay_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_salary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"basic" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"nopay_from_absence" boolean DEFAULT false NOT NULL,
	"ot_eligible" boolean DEFAULT false NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "employee_salary_basic" CHECK ("employee_salary"."basic" >= 0),
	CONSTRAINT "employee_salary_range" CHECK ("employee_salary"."effective_to" is null or "employee_salary"."effective_to" >= "employee_salary"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "employee_salary" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_tax_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"table_code" text,
	"is_resident" boolean DEFAULT true NOT NULL,
	"has_secondary_employment" boolean DEFAULT false NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "employee_tax_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "loan_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"period" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"payslip_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "loan_installments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"principal" numeric(14, 2) NOT NULL,
	"interest_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"installment_amount" numeric(14, 2) NOT NULL,
	"start_period" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "loans_positive" CHECK ("loans"."principal" > 0 and "loans"."installment_amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "loans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"calc" text NOT NULL,
	"formula" text,
	"is_epf_applicable" boolean DEFAULT false NOT NULL,
	"is_etf_applicable" boolean DEFAULT false NOT NULL,
	"is_apit_applicable" boolean DEFAULT false NOT NULL,
	"is_prorated" boolean DEFAULT false NOT NULL,
	"show_on_payslip" boolean DEFAULT true NOT NULL,
	"gl_code" text,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "pay_components_code_unique" UNIQUE("code"),
	CONSTRAINT "pay_components_kind_check" CHECK ("pay_components"."kind" in ('earning','deduction','employer_contribution','info')),
	CONSTRAINT "pay_components_calc_check" CHECK ("pay_components"."calc" in ('fixed','variable','formula','system')),
	CONSTRAINT "pay_components_formula" CHECK ("pay_components"."calc" <> 'formula' or "pay_components"."formula" is not null)
);
--> statement-breakpoint
ALTER TABLE "pay_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"quantity" numeric(10, 2),
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "payroll_inputs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"pay_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "payroll_periods_month" CHECK ("payroll_periods"."month" between 1 and 12),
	CONSTRAINT "payroll_periods_range" CHECK ("payroll_periods"."end_date" >= "payroll_periods"."start_date")
);
--> statement-breakpoint
ALTER TABLE "payroll_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"type" text DEFAULT 'regular' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"calculated_at" timestamp with time zone,
	"calculated_by" uuid,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"paid_at" timestamp with time zone,
	"paid_by" uuid,
	"config_snapshot" jsonb,
	"totals" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "payroll_runs_status_check" CHECK ("payroll_runs"."status" in ('draft','calculated','approved','locked','paid'))
);
--> statement-breakpoint
ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payslip_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payslip_id" uuid NOT NULL,
	"component_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"quantity" numeric(10, 2),
	"rate" numeric(14, 4),
	"ref" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "payslip_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"total_deductions" numeric(14, 2) NOT NULL,
	"net" numeric(14, 2) NOT NULL,
	"employer_cost" numeric(14, 2) NOT NULL,
	"epf_base" numeric(14, 2) NOT NULL,
	"etf_base" numeric(14, 2) NOT NULL,
	"apit_base" numeric(14, 2) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"trace" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pdf_path" text,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "payslips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "statutory_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" date NOT NULL,
	"epf_employee_rate" numeric(7, 4) NOT NULL,
	"epf_employer_rate" numeric(7, 4) NOT NULL,
	"etf_rate" numeric(7, 4) NOT NULL,
	"nopay_divisor_mode" text NOT NULL,
	"nopay_fixed_divisor" numeric(6, 2),
	"nopay_base" text NOT NULL,
	"ot_rate_base" text NOT NULL,
	"ot_divisor" numeric(8, 2) NOT NULL,
	"ot_multiplier_normal" numeric(5, 2) NOT NULL,
	"ot_multiplier_holiday" numeric(5, 2) NOT NULL,
	"rest_day_ot_as_holiday" boolean DEFAULT true NOT NULL,
	"rounding_mode" text NOT NULL,
	"rounding_scale" smallint DEFAULT 2 NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "statutory_settings_effective_from_unique" UNIQUE("effective_from"),
	CONSTRAINT "statutory_divisor" CHECK ("statutory_settings"."nopay_divisor_mode" <> 'fixed' or "statutory_settings"."nopay_fixed_divisor" > 0),
	CONSTRAINT "statutory_ot_divisor" CHECK ("statutory_settings"."ot_divisor" > 0),
	CONSTRAINT "statutory_scale" CHECK ("statutory_settings"."rounding_scale" between 0 and 2)
);
--> statement-breakpoint
ALTER TABLE "statutory_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_table_slabs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"from_amount" numeric(14, 2) NOT NULL,
	"to_amount" numeric(14, 2),
	"rate" numeric(7, 4) NOT NULL,
	"deduct_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "tax_slab_range" CHECK ("tax_table_slabs"."to_amount" is null or "tax_table_slabs"."to_amount" > "tax_table_slabs"."from_amount")
);
--> statement-breakpoint
ALTER TABLE "tax_table_slabs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"method" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"needs_review" boolean DEFAULT false NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "tax_tables_range" CHECK ("tax_tables"."effective_to" is null or "tax_tables"."effective_to" >= "tax_tables"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "tax_tables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_bank_codes" ADD CONSTRAINT "employee_bank_codes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_pay_components" ADD CONSTRAINT "employee_pay_components_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_pay_components" ADD CONSTRAINT "employee_pay_components_component_id_pay_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."pay_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salary" ADD CONSTRAINT "employee_salary_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_tax_profiles" ADD CONSTRAINT "employee_tax_profiles_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_inputs" ADD CONSTRAINT "payroll_inputs_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_inputs" ADD CONSTRAINT "payroll_inputs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_inputs" ADD CONSTRAINT "payroll_inputs_component_id_pay_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."pay_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_component_id_pay_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."pay_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_table_slabs" ADD CONSTRAINT "tax_table_slabs_table_id_tax_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tax_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_pay_components_employee" ON "employee_pay_components" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_salary_from" ON "employee_salary" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_tax_profiles_from" ON "employee_tax_profiles" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_installments_loan_period" ON "loan_installments" USING btree ("loan_id","period");--> statement-breakpoint
CREATE INDEX "loans_employee" ON "loans" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "payroll_inputs_run_employee" ON "payroll_inputs" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_periods_year_month" ON "payroll_periods" USING btree ("year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_one_regular" ON "payroll_runs" USING btree ("period_id") WHERE "payroll_runs"."type" = 'regular';--> statement-breakpoint
CREATE INDEX "payslip_lines_payslip" ON "payslip_lines" USING btree ("payslip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_run_employee" ON "payslips" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payslips_employee" ON "payslips" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "tax_table_slabs_table" ON "tax_table_slabs" USING btree ("table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_tables_code_from" ON "tax_tables" USING btree ("code","effective_from");