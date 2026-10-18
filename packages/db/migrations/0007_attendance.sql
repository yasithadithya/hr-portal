CREATE TABLE "attendance_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_id" uuid,
	"day_type" text NOT NULL,
	"expected" numeric(3, 2) NOT NULL,
	"leave_portion" numeric(3, 2) DEFAULT '0' NOT NULL,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"early_minutes" integer DEFAULT 0 NOT NULL,
	"ot_minutes" integer DEFAULT 0 NOT NULL,
	"ot_approved_minutes" integer,
	"ot_decided_by" uuid,
	"absent_portion" numeric(3, 2) DEFAULT '0' NOT NULL,
	"status" text NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"source_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "attendance_days_status_check" CHECK ("attendance_days"."status" in ('present','absent','half_day','on_leave','holiday','weekend','incomplete'))
);
--> statement-breakpoint
ALTER TABLE "attendance_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_device_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_user_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "attendance_device_users_device_user_id_unique" UNIQUE("device_user_id")
);
--> statement-breakpoint
ALTER TABLE "attendance_device_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"locked_by" uuid,
	"locked_at" timestamp with time zone,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "attendance_periods_month" CHECK ("attendance_periods"."month" between 1 and 12),
	CONSTRAINT "attendance_periods_status" CHECK ("attendance_periods"."status" in ('open','locked'))
);
--> statement-breakpoint
ALTER TABLE "attendance_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_punches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"accuracy_m" double precision,
	"ip" text,
	"device_id" text,
	"accepted" boolean DEFAULT true NOT NULL,
	"reject_reason" text,
	"note" text,
	"ref" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_punches_source_check" CHECK ("attendance_punches"."source" in ('pwa','web','device','manual','import'))
);
--> statement-breakpoint
ALTER TABLE "attendance_punches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "regularization_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"requested_in" timestamp with time zone,
	"requested_out" timestamp with time zone,
	"reason" text NOT NULL,
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
	CONSTRAINT "regularization_has_time" CHECK ("regularization_requests"."requested_in" is not null or "regularization_requests"."requested_out" is not null),
	CONSTRAINT "regularization_order" CHECK ("regularization_requests"."requested_in" is null or "regularization_requests"."requested_out" is null or "regularization_requests"."requested_out" > "regularization_requests"."requested_in"),
	CONSTRAINT "regularization_status_check" CHECK ("regularization_requests"."status" in ('pending','approved','rejected','withdrawn','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "regularization_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roster_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "roster_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "shift_assignments_range" CHECK ("shift_assignments"."effective_to" is null or "shift_assignments"."effective_to" >= "shift_assignments"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "shift_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"is_night_shift" boolean DEFAULT false NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"break_after_minutes" integer DEFAULT 0 NOT NULL,
	"grace_late_minutes" integer DEFAULT 0 NOT NULL,
	"early_leave_grace_minutes" integer DEFAULT 0 NOT NULL,
	"half_day_threshold_minutes" integer DEFAULT 0 NOT NULL,
	"ot_after_minutes" integer DEFAULT 0 NOT NULL,
	"window_before_minutes" integer DEFAULT 240 NOT NULL,
	"window_after_minutes" integer DEFAULT 360 NOT NULL,
	"color" text DEFAULT '#0ea5e9' NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "shifts_code_unique" UNIQUE("code"),
	CONSTRAINT "shifts_minutes_nonneg" CHECK ("shifts"."break_minutes" >= 0 and "shifts"."break_after_minutes" >= 0 and "shifts"."grace_late_minutes" >= 0 and "shifts"."early_leave_grace_minutes" >= 0 and "shifts"."half_day_threshold_minutes" >= 0 and "shifts"."ot_after_minutes" >= 0 and "shifts"."window_before_minutes" >= 0 and "shifts"."window_after_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_users" ADD CONSTRAINT "attendance_device_users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regularization_requests" ADD CONSTRAINT "regularization_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regularization_requests" ADD CONSTRAINT "regularization_requests_current_approver_employee_id_employees_id_fk" FOREIGN KEY ("current_approver_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_days_employee_date" ON "attendance_days" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "attendance_days_date_status" ON "attendance_days" USING btree ("date","status");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_periods_year_month" ON "attendance_periods" USING btree ("year","month");--> statement-breakpoint
CREATE INDEX "attendance_punches_employee_at" ON "attendance_punches" USING btree ("employee_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_punches_device_dedupe" ON "attendance_punches" USING btree ("employee_id","at","source") WHERE "attendance_punches"."source" in ('device','import');--> statement-breakpoint
CREATE INDEX "regularization_employee_date" ON "regularization_requests" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "regularization_pending" ON "regularization_requests" USING btree ("status","current_approver_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_entries_employee_date" ON "roster_entries" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "roster_entries_date" ON "roster_entries" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_assignments_employee_from" ON "shift_assignments" USING btree ("employee_id","effective_from");