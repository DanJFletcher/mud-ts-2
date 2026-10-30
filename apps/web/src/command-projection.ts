import type { CommandResponse } from "@mudd/client-sdk";

/**
 * The game projection a successful command returned, if the client may apply
 * it. When the realtime socket already reports a newer character revision,
 * something committed after the server built it, so the caller must fetch a
 * snapshot instead.
 */
export function commandResultProjection(response: CommandResponse, hintedCharacterRevision?: number) {
  const projection = response.gameProjection ?? response.movementProjection;
  if (!projection) return undefined;
  if (hintedCharacterRevision !== undefined && hintedCharacterRevision > projection.character.revision) {
    return undefined;
  }
  return projection;
}
