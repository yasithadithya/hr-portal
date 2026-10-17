CREATE TABLE "approval_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module" text NOT NULL,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "approval_flows_module_unique" UNIQUE("module")
);
--> statement-breakpoint
ALTER TABLE "approval_flows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"period_year" smallint NOT NULL,
	"entry_type" text NOT NULL,
	"amount" numeric(8, 2) NOT NULL,
	"idempotency_key" text,
	"ref_type" text,
	"ref_id" uuid,
	"note" text,
	"effective_date" date NOT NULL,
	"created_by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_ledger_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "leave_ledger_entry_type_check" CHECK ("leave_ledger"."entry_type" in ('opening','accrual','carry_forward','taken','reversal','adjustment','expiry','encashment'))
);
--> statement-breakpoint
ALTER TABLE "leave_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"applies_to" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entitlement" numeric(6, 2) DEFAULT '0' NOT NULL,
	"accrual" text DEFAULT 'upfront_yearly' NOT NULL,
	"proration_on_join" text DEFAULT 'monthly' NOT NULL,
	"rounding" text DEFAULT 'floor_half' NOT NULL,
	"eligible_after_months" integer DEFAULT 0 NOT NULL,
	"carry_forward_max" numeric(6, 2) DEFAULT '0' NOT NULL,
	"carry_forward_expiry_months" integer,
	"encashable" boolean DEFAULT false NOT NULL,
	"effective_from" date NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "leave_policies_entitlement_nonneg" CHECK ("leave_policies"."entitlement" >= 0),
	CONSTRAINT "leave_policies_carry_nonneg" CHECK ("leave_policies"."carry_forward_max" >= 0)
);
--> statement-breakpoint
ALTER TABLE "leave_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_request_days" (
	"request_id" uuid NOT NULL,
	"date" date NOT NULL,
	"portion" numeric(5, 2) NOT NULL,
	"half" text DEFAULT 'full' NOT NULL,
	CONSTRAINT "leave_request_days_request_id_date_pk" PRIMARY KEY("request_id","date")
);
--> statement-breakpoint
ALTER TABLE "leave_request_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"period_year" smallint NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_half" text DEFAULT 'full' NOT NULL,
	"end_half" text DEFAULT 'full' NOT NULL,
	"hours" numeric(5, 2),
	"amount" numeric(8, 2) NOT NULL,
	"reason" text,
	"attachment_path" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_step" smallint DEFAULT 0 NOT NULL,
	"current_approver_employee_id" uuid,
	"approval_trail" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "leave_requests_range" CHECK ("leave_requests"."end_date" >= "leave_requests"."start_date"),
	CONSTRAINT "leave_requests_status_check" CHECK ("leave_requests"."status" in ('pending','approved','rejected','cancelled','withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"unit" text DEFAULT 'half_day' NOT NULL,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"requires_attachment_after_days" numeric(6, 2),
	"max_consecutive_days" numeric(6, 2),
	"min_notice_days" integer DEFAULT 0 NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"gender_restriction" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "leave_types_code_unique" UNIQUE("code"),
	CONSTRAINT "leave_types_unit_check" CHECK ("leave_types"."unit" in ('day','half_day','hour'))
);
--> statement-breakpoint
ALTER TABLE "leave_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_year_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_year" smallint NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ran_by" uuid,
	"summary" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_year_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_request_id_leave_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."leave_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_current_approver_employee_id_employees_id_fk" FOREIGN KEY ("current_approver_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_ledger_balance_idx" ON "leave_ledger" USING btree ("employee_id","leave_type_id","period_year");--> statement-breakpoint
CREATE INDEX "leave_policies_type_idx" ON "leave_policies" USING btree ("leave_type_id");--> statement-breakpoint
CREATE INDEX "leave_request_days_date_idx" ON "leave_request_days" USING btree ("date");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx" ON "leave_requests" USING btree ("employee_id","start_date");--> statement-breakpoint
CREATE INDEX "leave_requests_pending_idx" ON "leave_requests" USING btree ("status","current_approver_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_year_runs_from_year" ON "leave_year_runs" USING btree ("from_year");