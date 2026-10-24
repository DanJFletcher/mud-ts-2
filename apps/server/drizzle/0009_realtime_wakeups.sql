-- Post-commit routing metadata only; never publishes domain payloads.
CREATE OR REPLACE FUNCTION mudd_realtime_wakeup() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  world_id text;
  notice json;
  old_room text;
  new_room text;
BEGIN
  world_id := COALESCE(NEW.world_instance_id, OLD.world_instance_id);
  IF TG_TABLE_NAME = 'game_events' THEN
    IF NEW.stream_id LIKE 'world-interactions:%' THEN
      notice := json_build_object('world', world_id, 'kind', 'interaction');
    ELSIF NEW.stream_id = 'world-groups' THEN
      notice := json_build_object('world', world_id, 'kind', 'party');
    ELSIF NEW.stream_id = 'world-team-combat' THEN
      notice := json_build_object('world', world_id, 'kind', 'team');
    ELSIF NEW.stream_id LIKE 'world-npc:%' THEN
      old_room := COALESCE(NEW.payload->>'fromLocationId', NEW.payload->>'locationId');
      new_room := COALESCE(NEW.payload->>'toLocationId', NEW.payload->>'locationId');
      IF old_room IS NOT NULL THEN
        PERFORM pg_notify('mudd_realtime', json_build_object(
          'world', world_id, 'kind', 'room', 'roomId', old_room
        )::text);
      END IF;
      notice := json_build_object('world', world_id, 'kind', 'room', 'roomId', new_room);
    ELSE
      SELECT location_id INTO old_room FROM room_character_states
        WHERE character_id::text = NEW.stream_id AND world_instance_id = world_id;
      new_room := COALESCE(NEW.payload->>'toLocationId', NEW.payload->>'locationId',
        NEW.payload->'character'->>'locationId');
      notice := json_build_object('world', world_id, 'kind', 'character',
        'characterId', NEW.stream_id, 'roomId', new_room);
      IF NEW.payload->>'fromLocationId' IS NOT NULL THEN
        old_room := NEW.payload->>'fromLocationId';
      END IF;
      IF old_room IS NOT NULL AND old_room IS DISTINCT FROM new_room THEN
        PERFORM pg_notify('mudd_realtime', json_build_object(
          'world', world_id, 'kind', 'room', 'roomId', old_room
        )::text);
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'room_chat_messages' THEN
    notice := json_build_object('world', world_id, 'kind', 'room', 'roomId', NEW.room_id);
  ELSE
    notice := json_build_object('world', world_id, 'kind', 'membership',
      'playerId', COALESCE(NEW.player_id, OLD.player_id));
  END IF;
  PERFORM pg_notify('mudd_realtime', notice::text);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS mudd_game_wakeup ON game_events;
--> statement-breakpoint
CREATE TRIGGER mudd_game_wakeup AFTER INSERT ON game_events
FOR EACH ROW EXECUTE FUNCTION mudd_realtime_wakeup();
--> statement-breakpoint
DROP TRIGGER IF EXISTS mudd_chat_wakeup ON room_chat_messages;
--> statement-breakpoint
CREATE TRIGGER mudd_chat_wakeup AFTER INSERT ON room_chat_messages
FOR EACH ROW EXECUTE FUNCTION mudd_realtime_wakeup();
--> statement-breakpoint
DROP TRIGGER IF EXISTS mudd_presence_wakeup ON world_sessions;
--> statement-breakpoint
CREATE TRIGGER mudd_presence_wakeup AFTER INSERT OR DELETE OR UPDATE OF character_id, world_instance_id ON world_sessions
FOR EACH ROW EXECUTE FUNCTION mudd_realtime_wakeup();
