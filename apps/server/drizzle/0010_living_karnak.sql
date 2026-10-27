CREATE TABLE IF NOT EXISTS "room_character_states" (
	"character_id" uuid PRIMARY KEY NOT NULL,
	"world_instance_id" text NOT NULL,
	"location_id" text NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_object_lifecycles" (
	"world_instance_id" text NOT NULL,
	"object_id" text NOT NULL,
	"object_type" text NOT NULL,
	"location_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"revision" integer NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	CONSTRAINT "world_object_lifecycles_pk" PRIMARY KEY("world_instance_id","object_id"),
	CONSTRAINT "world_object_lifecycles_state_check" CHECK ("world_object_lifecycles"."state" in ('scheduled', 'expiring', 'expired', 'cancelled')),
	CONSTRAINT "world_object_lifecycles_revision_check" CHECK ("world_object_lifecycles"."revision" >= 1)
);
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'room_character_states_character_id_fkey'
			AND conrelid = 'public.room_character_states'::regclass
	) AND NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'room_character_states_character_id_characters_id_fk'
			AND conrelid = 'public.room_character_states'::regclass
	) THEN
		EXECUTE 'ALTER TABLE "room_character_states" RENAME CONSTRAINT "room_character_states_character_id_fkey" TO "room_character_states_character_id_characters_id_fk"';
	ELSIF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'room_character_states_character_id_characters_id_fk'
			AND conrelid = 'public.room_character_states'::regclass
	) THEN
		EXECUTE 'ALTER TABLE "room_character_states" ADD CONSTRAINT "room_character_states_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action';
	END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_character_states_room_idx" ON "room_character_states" USING btree ("world_instance_id","location_id");--> statement-breakpoint
CREATE INDEX "world_object_lifecycles_due_idx" ON "world_object_lifecycles" USING btree ("world_instance_id","state","expires_at","lease_until");