/**
 * Format a blueprint station id into a learner-facing label.
 */
export function formatLabel(id: string): string {
	return id
		.split(/[_-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

/** Shared options for label formatting. */
export interface FormatLabelOptions {
	separator?: string;
}
