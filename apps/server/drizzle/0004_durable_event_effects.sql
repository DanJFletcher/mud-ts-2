CREATE TABLE "durable_effects" (
  "id" uuid PRIMARY KEY NOT NULL,
  "world_instance_id" text NOT NULL,
  "source_stream_id" text,
  "causation_command_id" text NOT NULL,
  "effect_type" text NOT NULL,
  "effect_version" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "dedupe_key" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_until" timestamp with time zone,
  "lease_token" uuid,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "durable_effects_status_check" CHECK ("status" IN ('pending', 'processing', 'completed', 'dead')),
  CONSTRAINT "durable_effects_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "durable_effects_version_check" CHECK ("effect_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "durable_effects_dedupe_idx" ON "durable_effects" USING btree ("dedupe_key");
--> statement-breakpoint
CREATE INDEX "durable_effects_pending_idx" ON "durable_effects" USING btree ("status", "available_at", "created_at");
--> statement-breakpoint
ALTER TABLE "room_chat_messages" ADD COLUMN "source_effect_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "room_chat_messages_source_effect_id_idx" ON "room_chat_messages" USING btree ("source_effect_id");
