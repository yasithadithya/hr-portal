ALTER TABLE "employees" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "privacy_ack_version" integer;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "privacy_ack_at" timestamp with time zone;