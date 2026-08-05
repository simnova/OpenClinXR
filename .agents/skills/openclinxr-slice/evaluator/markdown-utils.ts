// Markdown helpers for the openclinxr-slice evaluator

export function normalizeHeading(value: string): string {
	return value.trim().toLowerCase();
}

export function parseMarkdownSections(markdown: string): Map<string, string> {
	const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
	const sections = new Map<string, string>();

	for (let index = 0; index < matches.length; index += 1) {
		const current = matches[index];
		const next = matches[index + 1];
		const heading = normalizeHeading(current[1] ?? '');
		const start = (current.index ?? 0) + current[0].length;
		const end = next?.index ?? markdown.length;
		const body = markdown.slice(start, end).trim();
		sections.set(heading, body);
	}

	return sections;
}

/**
 * A section counts as boilerplate when it is still a scaffold placeholder.
 * Generating the template alone cannot score points.
 */
export function isTemplateBoilerplate(value: string): boolean {
	return (
		/\bTODO\b:?/i.test(value) ||
		/\breplace this section\b/i.test(value) ||
		/\{\{[A-Z0-9_]+\}\}/.test(value) ||
		/\bFIXME\b/i.test(value) ||
		/\bTBD\b/i.test(value)
	);
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasHeading(markdown: string, heading: string): boolean {
	const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'im');
	return pattern.test(markdown);
}

/**
 * Extract filesystem-looking path references from markdown:
 * - backtick paths: `path/to/file`
 * - markdown links: [label](path/to/file) (non-http)
 * - evidence: path/to/file patterns after common verbs
 */
export function extractPathReferences(markdown: string): string[] {
	const found = new Set<string>();

	for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
		const candidate = (match[1] ?? '').trim();
		if (looksLikePath(candidate)) {
			found.add(candidate);
		}
	}

	for (const match of markdown.matchAll(/\[[^\]]*]\(([^)\s]+)\)/g)) {
		const candidate = (match[1] ?? '').trim();
		if (looksLikePath(candidate) && !/^https?:\/\//i.test(candidate)) {
			found.add(candidate);
		}
	}

	return [...found];
}

function looksLikePath(value: string): boolean {
	if (!value || value.length < 3 || value.length > 260) {
		return false;
	}
	// Exclude pure identifiers and shell one-liners without a path separator or extension
	if (/^pnpm\s/i.test(value) || /^npm\s/i.test(value) || /^node\s/i.test(value)) {
		return false;
	}
	if (value.includes(' ') && !value.includes('/')) {
		return false;
	}
	return (
		value.includes('/') ||
		/\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|png|webm|log|yml|yaml|toml)$/i.test(value)
	);
}
