-- Keep the one-call append function aligned with the transaction path's
-- READ COMMITTED snapshot requirement. MU001 lets the application safely
-- retry this statement through the transaction append path.
CREATE OR REPLACE FUNCTION mudd_append_command_v1(p_request jsonb)
RETURNS TABLE (
  outcome text,
  prior_stream_id text,
  prior_payload_hash text,
  prior_receipt jsonb,
  prior_events jsonb,
  current_revision integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_world text := p_request->>'worldInstanceId';
  v_actor_text text := p_request->>'actorId';
  v_actor uuid := (p_request->>'actorId')::uuid;
  v_command text := p_request->>'commandId';
  v_stream text := p_request->>'streamId';
  v_prior command_receipts%ROWTYPE;
  v_lock_stream text;
  v_check jsonb;
  v_head integer;
BEGIN
  -- The receipt lookup below relies on each statement taking a fresh snapshot.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'mudd_append_command_v1 requires READ COMMITTED isolation'
      USING ERRCODE = 'MU001';
  END IF;

  -- Same lock keys as the transaction path, so both paths serialize together.
  PERFORM pg_advisory_xact_lock(hashtext(v_world), hashtext(v_actor_text || ':' || v_command));
  -- A separate statement after the lock: under READ COMMITTED it sees a
  -- duplicate that committed while this call waited.
  SELECT * INTO v_prior FROM command_receipts
   WHERE world_instance_id = v_world AND actor_id = v_actor AND command_id = v_command;
  IF FOUND THEN
    RETURN QUERY SELECT 'prior'::text, v_prior.stream_id, v_prior.payload_hash,
      v_prior.receipt, v_prior.events, NULL::integer;
    RETURN;
  END IF;

  -- Deterministic lock order avoids deadlocks across encounter and character writers.
  FOR v_lock_stream IN
    SELECT stream_id FROM jsonb_array_elements_text(p_request->'lockStreamIds') AS streams(stream_id)
     ORDER BY stream_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(v_world), hashtext(v_lock_stream));
  END LOOP;

  -- Heads are authoritative once their locks are held.
  FOR v_check IN SELECT value FROM jsonb_array_elements(p_request->'checks') LOOP
    SELECT coalesce(max(stream_version), 0) INTO v_head FROM game_events
     WHERE world_instance_id = v_world AND stream_id = v_check->>'streamId';
    IF v_head <> (v_check->>'expectedVersion')::integer THEN
      RETURN QUERY SELECT 'guard_conflict'::text, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb, v_head;
      RETURN;
    END IF;
  END LOOP;
  SELECT coalesce(max(stream_version), 0) INTO v_head FROM game_events
   WHERE world_instance_id = v_world AND stream_id = v_stream;
  IF v_head <> (p_request->>'expectedVersion')::integer THEN
    RETURN QUERY SELECT 'version_conflict'::text, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb, v_head;
    RETURN;
  END IF;

  INSERT INTO game_events (
    event_id, world_instance_id, stream_id, stream_version, type, contract_version,
    payload, causation_command_id, actor_id, occurred_at, tick
  )
  SELECT e.event_id, v_world, e.stream_id, e.stream_version, e.type, e.contract_version,
    e.payload, v_command, v_actor, e.occurred_at, e.tick
  FROM jsonb_to_recordset(p_request->'events') AS e(
    event_id uuid, stream_id text, stream_version integer, type text,
    contract_version integer, payload jsonb, occurred_at timestamptz, tick integer
  );

  INSERT INTO command_receipts (
    world_instance_id, actor_id, command_id, payload_hash, stream_id, receipt, events
  ) VALUES (
    v_world, v_actor, v_command, p_request->>'payloadHash', v_stream,
    p_request->'receipt', p_request->'receiptEvents'
  );

  INSERT INTO durable_effects (
    id, world_instance_id, source_stream_id, causation_command_id,
    effect_type, effect_version, payload, dedupe_key
  )
  SELECT f.id, v_world, v_stream, v_command, f.effect_type, f.effect_version, f.payload, f.dedupe_key
  FROM jsonb_to_recordset(p_request->'effects') AS f(
    id uuid, effect_type text, effect_version integer, payload jsonb, dedupe_key text
  );

  -- Room read models are computed by the caller from its verified history;
  -- only streams that belong to a character in that world get a row.
  INSERT INTO room_character_states (
    character_id, world_instance_id, location_id, revision, schema_version, state
  )
  SELECT r.character_id, v_world, r.location_id, r.revision, 1, r.state
  FROM jsonb_to_recordset(p_request->'roomStates') AS r(
    character_id uuid, location_id text, revision integer, state jsonb
  )
  WHERE EXISTS (
    SELECT 1 FROM characters c WHERE c.id = r.character_id AND c.world_instance_id = v_world
  )
  ON CONFLICT (character_id) DO UPDATE SET
    world_instance_id = EXCLUDED.world_instance_id,
    location_id = EXCLUDED.location_id,
    revision = EXCLUDED.revision,
    schema_version = EXCLUDED.schema_version,
    state = EXCLUDED.state;

  RETURN QUERY SELECT 'committed'::text, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb, v_head;
END;
$$;
