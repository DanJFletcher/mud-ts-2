CREATE TABLE "room_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"world_instance_id" text NOT NULL,
	"room_id" text NOT NULL,
	"speaker_type" text NOT NULL,
	"speaker_id" text NOT NULL,
	"speaker_name" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "room_chat_messages_world_room_id_idx" ON "room_chat_messages" USING btree ("world_instance_id","room_id","id");