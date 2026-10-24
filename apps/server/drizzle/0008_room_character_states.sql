CREATE TABLE "room_character_states" (
  "character_id" uuid PRIMARY KEY REFERENCES "characters"("id") ON DELETE CASCADE,
  "world_instance_id" text NOT NULL,
  "location_id" text NOT NULL,
  "revision" integer NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "room_character_states_room_idx" ON "room_character_states" ("world_instance_id", "location_id");
