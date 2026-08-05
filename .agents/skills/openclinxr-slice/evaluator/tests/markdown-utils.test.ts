import { describe, expect, it } from 'vitest';
import {
	extractPathReferences,
	isTemplateBoilerplate,
	parseMarkdownSections,
} from '../markdown-utils.ts';

describe('parseMarkdownSections', () => {
	it('splits on ## headings', () => {
		const md = '## What changed\n\nAlpha work.\n\n## Evidence passed\n\n`evidence/a.txt`\n';
		const sections = parseMarkdownSections(md);
		expect(sections.get('what changed')).toContain('Alpha work');
		expect(sections.get('evidence passed')).toContain('evidence/a.txt');
	});
});

describe('isTemplateBoilerplate', () => {
	it('flags TODO and replace-this-section scaffolds', () => {
		expect(isTemplateBoilerplate('TODO: replace this section with details')).toBe(true);
		expect(isTemplateBoilerplate('{{SLICE_ID}} still here')).toBe(true);
		expect(isTemplateBoilerplate('Concrete description of the package export change.')).toBe(
			false,
		);
	});
});

describe('extractPathReferences', () => {
	it('collects backtick paths and markdown links, ignores http and pnpm commands', () => {
		const md = [
			'See `evidence/verify-log.txt` and [report](evidence/report.json).',
			'Also `pnpm --filter demo test` should not count.',
			'Remote [doc](https://example.com/x) ignored.',
		].join('\n');
		const refs = extractPathReferences(md);
		expect(refs).toContain('evidence/verify-log.txt');
		expect(refs).toContain('evidence/report.json');
		expect(refs.some((r) => r.includes('pnpm'))).toBe(false);
		expect(refs.some((r) => r.includes('https://'))).toBe(false);
	});
});
