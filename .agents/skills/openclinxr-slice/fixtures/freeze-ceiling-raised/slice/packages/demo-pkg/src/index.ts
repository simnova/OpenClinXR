/**
 * Format a blueprint station id into a learner-facing label.
 */
export function formatLabel(id: string): string {
	return id.replaceAll('_', ' ');
}
