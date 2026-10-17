CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TABLE "platform"."plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"max_employees" integer,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "platform"."plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "platform"."platform_admins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."provisioning_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."provisioning_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."tenant_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"host" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_domains_host_unique" UNIQUE("host"),
	CONSTRAINT "tenant_domains_host_lower" CHECK ("platform"."tenant_domains"."host" = lower("platform"."tenant_domains"."host"))
);
--> statement-breakpoint
ALTER TABLE "platform"."tenant_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."tenant_migrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"migration_name" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_migrations_tenant_name" UNIQUE("tenant_id","migration_name")
);
--> statement-breakpoint
ALTER TABLE "platform"."tenant_migrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."tenant_secrets" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"db_url_enc" text NOT NULL,
	"db_direct_url_enc" text,
	"service_role_key_enc" text,
	"anon_key" text,
	"supabase_url" text,
	"jwks_url" text,
	"rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."tenant_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"plan_id" uuid,
	"supabase_project_ref" text,
	"region" text,
	"timezone" text DEFAULT 'Asia/Colombo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_status_check" CHECK ("platform"."tenants"."status" in ('provisioning','active','suspended','archived')),
	CONSTRAINT "tenants_slug_check" CHECK ("platform"."tenants"."slug" ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$')
);
--> statement-breakpoint
ALTER TABLE "platform"."tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."provisioning_events" ADD CONSTRAINT "provisioning_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_migrations" ADD CONSTRAINT "tenant_migrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenant_secrets" ADD CONSTRAINT "tenant_secrets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD CONSTRAINT "tenants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "platform"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provisioning_events_tenant_idx" ON "platform"."provisioning_events" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "tenant_domains_tenant_idx" ON "platform"."tenant_domains" USING btree ("tenant_id");