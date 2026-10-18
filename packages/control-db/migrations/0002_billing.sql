CREATE TABLE "platform"."billing_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"active_employees" integer NOT NULL,
	"plan_key" text,
	"price_per_employee" numeric(10, 2),
	"minimum_monthly" numeric(10, 2),
	"amount" numeric(14, 2),
	"currency" text DEFAULT 'LKR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."billing_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."plans" ADD COLUMN "price_per_employee" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "platform"."plans" ADD COLUMN "minimum_monthly" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "platform"."plans" ADD COLUMN "currency" text DEFAULT 'LKR' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."billing_snapshots" ADD CONSTRAINT "billing_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_snapshots_tenant_month" ON "platform"."billing_snapshots" USING btree ("tenant_id","month");