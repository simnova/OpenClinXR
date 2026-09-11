export function countActorCommunicationProfiles(
  actors: readonly { communicationProfile?: unknown | null }[],
): number {
  return actors.filter((actor) => actor.communicationProfile).length;
}

export function formatActorCommunicationProfileCoverage(
  actors: readonly { communicationProfile?: unknown | null }[],
): string {
  const profileCount = countActorCommunicationProfiles(actors);
  return `${profileCount} of ${actors.length} actors include behavior profiles for faculty review.`;
}

export function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)}m`;
}

export function uniqueWorkbenchValues(values: string[]): string[] {
  return [...new Set(values)];
}

export function pluralizeWorkbenchCount(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

export function clampedScoreFromWorkbenchInput(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(2, Math.max(0, parsed));
}

export function capabilityTagColor(tag: string): string {
  const colorByTag = new Map([
    ["GraphQL Codegen", "green"],
    ["Apollo Client", "blue"],
    ["ProComponents v3", "purple"],
    ["React Router", "cyan"],
    ["Ant Design 6", "gold"],
  ]);

  return colorByTag.get(tag) ?? "default";
}
