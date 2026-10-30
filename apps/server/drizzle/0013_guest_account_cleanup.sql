-- One-time cleanup. Preserve shared world streams (including world-items and
-- lifecycle events); remove account-owned records and character stream history.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM data_migrations WHERE id = 'cleanup_guest_accounts_v1'
  ) THEN
    DELETE FROM durable_effects
    WHERE source_stream_id IN (
      SELECT c.id::text
      FROM characters c
      JOIN players p ON p.id = c.player_id
      WHERE p.clerk_user_id IS NULL
    );

    DELETE FROM command_receipts
    WHERE actor_id IN (
      SELECT id FROM players WHERE clerk_user_id IS NULL
    )
    OR stream_id IN (
      SELECT c.id::text
      FROM characters c
      JOIN players p ON p.id = c.player_id
      WHERE p.clerk_user_id IS NULL
    );

    DELETE FROM game_events
    WHERE stream_id IN (
      SELECT c.id::text
      FROM characters c
      JOIN players p ON p.id = c.player_id
      WHERE p.clerk_user_id IS NULL
    );

    -- Cascades to sessions, characters, room state, world sessions, and chat.
    DELETE FROM players
    WHERE clerk_user_id IS NULL;

    INSERT INTO data_migrations (id)
    VALUES ('cleanup_guest_accounts_v1')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
