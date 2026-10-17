CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"world_instance_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_receipts" (
	"world_instance_id" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"command_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"stream_id" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"events" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_receipts_pk" PRIMARY KEY("world_instance_id","actor_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "game_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"world_instance_id" text NOT NULL,
	"stream_id" text NOT NULL,
	"stream_version" integer NOT NULL,
	"type" text NOT NULL,
	"contract_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"causation_command_id" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"tick" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "characters_owner_instance_idx" ON "characters" USING btree ("player_id","world_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_events_instance_stream_revision_idx" ON "game_events" USING btree ("world_instance_id","stream_id","stream_version");