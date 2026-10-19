ALTER TABLE "world_sessions" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
UPDATE "world_sessions" SET "last_seen_at" = "created_at";--> statement-breakpoint
ALTER TABLE "world_sessions" ALTER COLUMN "last_seen_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "world_sessions" ALTER COLUMN "last_seen_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "world_sessions_presence_idx" ON "world_sessions" USING btree ("world_instance_id","last_seen_at");