ALTER TABLE "room_chat_messages"
  ADD COLUMN "player_id" uuid,
  ADD COLUMN "submission_id" text;
--> statement-breakpoint
ALTER TABLE "room_chat_messages"
  ADD CONSTRAINT "room_chat_messages_player_id_players_id_fk"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX "room_chat_messages_player_submission_idx"
  ON "room_chat_messages" USING btree ("world_instance_id", "player_id", "submission_id");
