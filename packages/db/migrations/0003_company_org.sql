CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calendar_id" uuid,
	"geo_lat" numeric(9, 6),
	"geo_lng" numeric(9, 6),
	"geo_radius_m" integer,
	"allowed_ips" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "branches_code_unique" UNIQUE("code"),
	CONSTRAINT "branches_geo_all_or_none" CHECK (("branches"."geo_lat" is null) = ("branches"."geo_lng" is null)),
	CONSTRAINT "branches_radius_positive" CHECK ("branches"."geo_radius_m" is null or "branches"."geo_radius_m" > 0)
);
--> statement-breakpoint
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"reg_no" text,
	"epf_reg_no" text,
	"etf_reg_no" text,
	"tin" text,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"phone" text,
	"email" text,
	"logo_path" text,
	"timezone" text DEFAULT 'Asia/Colombo' NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"fiscal_year_start_month" smallint DEFAULT 4 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "company_profile_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "company_profile_singleton" CHECK ("company_profile"."singleton"),
	CONSTRAINT "company_profile_fy_month" CHECK ("company_profile"."fiscal_year_start_month" between 1 and 12)
);
--> statement-breakpoint
ALTER TABLE "company_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "cost_centers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"head_employee_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "departments_code_unique" UNIQUE("code"),
	CONSTRAINT "departments_not_own_parent" CHECK ("departments"."parent_id" is null or "departments"."parent_id" <> "departments"."id")
);
--> statement-breakpoint
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "designations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"grade_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "designations_title_unique" UNIQUE("title")
);
--> statement-breakpoint
ALTER TABLE "designations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "grades_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "grades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	"padding" smallint DEFAULT 4 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "number_sequences_key_unique" UNIQUE("key"),
	CONSTRAINT "number_sequences_next_positive" CHECK ("number_sequences"."next_value" >= 1),
	CONSTRAINT "number_sequences_padding" CHECK ("number_sequences"."padding" between 0 and 12)
);
--> statement-breakpoint
ALTER TABLE "number_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"work_week" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "work_calendars_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "work_calendars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_calendar_id_work_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."work_calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_employee_id_employees_id_fk" FOREIGN KEY ("head_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designations" ADD CONSTRAINT "designations_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_calendar_id_work_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."work_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "departments_parent_idx" ON "departments" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_calendar_date_name" ON "holidays" USING btree ("calendar_id","date","name");--> statement-breakpoint
CREATE INDEX "holidays_calendar_date" ON "holidays" USING btree ("calendar_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "work_calendars_one_default" ON "work_calendars" USING btree ("is_default") WHERE "work_calendars"."is_default";