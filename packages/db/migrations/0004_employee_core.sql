CREATE TABLE "employee_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "employee_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"relationship" text,
	"phone" text,
	"dob" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "employee_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"expiry_date" date,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "employee_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_job_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"branch_id" uuid,
	"department_id" uuid,
	"designation_id" uuid,
	"grade_id" uuid,
	"cost_center_id" uuid,
	"reports_to_id" uuid,
	"employment_type" text NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "job_history_range" CHECK ("employee_job_history"."effective_to" is null or "employee_job_history"."effective_to" >= "employee_job_history"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "employee_job_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "name_with_initials" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "preferred_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "nic" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "passport_no" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "dob" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "marital_status" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "religion" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "personal_email" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "mobile" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "address" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "photo_path" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "designation_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "grade_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "cost_center_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "employment_type" text DEFAULT 'permanent' NOT NULL;--> statement-breakpoint
-- Existing rows (pre-Phase 4) get today as a placeholder join date; HR corrects it.
ALTER TABLE "employees" ADD COLUMN "join_date" date DEFAULT CURRENT_DATE NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "join_date" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "probation_end_date" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "confirmation_date" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "contract_end_date" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "exit_date" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "exit_reason" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bank_branch" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bank_account_no" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bank_account_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "epf_no" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "etf_no" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "tax_file_no" text;--> statement-breakpoint
ALTER TABLE "employee_change_requests" ADD CONSTRAINT "employee_change_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contacts" ADD CONSTRAINT "employee_contacts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_designation_id_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."designations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_reports_to_id_employees_id_fk" FOREIGN KEY ("reports_to_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_change_requests_employee_idx" ON "employee_change_requests" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "employee_contacts_employee_idx" ON "employee_contacts" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_documents_employee_idx" ON "employee_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_documents_expiry_idx" ON "employee_documents" USING btree ("expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "job_history_employee_from" ON "employee_job_history" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "job_history_employee_range" ON "employee_job_history" USING btree ("employee_id","effective_from","effective_to");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_designation_id_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."designations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employees_department_idx" ON "employees" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "employees_branch_idx" ON "employees" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_nic_unique" ON "employees" USING btree ("nic") WHERE "employees"."nic" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_epf_unique" ON "employees" USING btree ("epf_no") WHERE "employees"."epf_no" is not null;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_type_check" CHECK ("employees"."employment_type" in ('permanent','contract','probation','intern','part_time','consultant'));--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_exit_after_join" CHECK ("employees"."exit_date" is null or "employees"."exit_date" >= "employees"."join_date");
--> statement-breakpoint
-- Every employee needs an opening job-history row so "department on date X" always resolves.
INSERT INTO "employee_job_history" ("employee_id", "effective_from", "branch_id", "department_id", "designation_id", "grade_id", "cost_center_id", "reports_to_id", "employment_type", "reason")
SELECT "id", "join_date", "branch_id", "department_id", "designation_id", "grade_id", "cost_center_id", "reports_to_id", "employment_type", 'hire'
FROM "employees" e
WHERE NOT EXISTS (SELECT 1 FROM "employee_job_history" h WHERE h."employee_id" = e."id");
