ALTER TABLE "platform"."tenant_secrets" ADD COLUMN "vapid_public_key" text;--> statement-breakpoint
ALTER TABLE "platform"."tenant_secrets" ADD COLUMN "vapid_private_key_enc" text;