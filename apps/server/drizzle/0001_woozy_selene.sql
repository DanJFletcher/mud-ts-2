CREATE TABLE "world_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"world_instance_id" text NOT NULL,
	"character_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "characters_owner_instance_idx";--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "clerk_user_id" text;--> statement-breakpoint
ALTER TABLE "world_sessions" ADD CONSTRAINT "world_sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_sessions" ADD CONSTRAINT "world_sessions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "world_sessions_owner_instance_idx" ON "world_sessions" USING btree ("player_id","world_instance_id");--> statement-breakpoint
CREATE INDEX "world_sessions_character_idx" ON "world_sessions" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "characters_owner_instance_idx" ON "characters" USING btree ("player_id","world_instance_id");--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_clerk_user_id_unique" UNIQUE("clerk_user_id");