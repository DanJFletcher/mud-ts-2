export type RenderJob =
  | { kind: "text"; value: string }
  | { kind: "image"; source: string };

export function renderJob(job: RenderJob): string {
  switch (job.kind) {
    case "text":
      return job.value;
    case "image":
      return `image:${job.source}`;
  }
}

export interface PersistedProfile {
  id: string;
  displayName?: string;
}

export function readProfile(raw: unknown): PersistedProfile {
  // Existing records may omit displayName; callers rely on the fallback.
  return raw as PersistedProfile;
}

export function displayName(profile: PersistedProfile): string {
  return profile.displayName ?? "Traveler";
}
