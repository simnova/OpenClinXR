import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	collectExportsFromEntry,
	parseSizeFreezeEntries,
} from '../ts-ast.ts';

describe('collectExportsFromEntry (TypeScript AST)', () => {
	it('finds multi-line function exports and re-exports without regex', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ocx-slice-ast-'));
		const impl = join(dir, 'impl.ts');
		const entry = join(dir, 'index.ts');

		writeFileSync(
			impl,
			`
export function formatLabel(
  id: string,
  opts?: { sep?: string },
): string {
  return id;
}

export function unusedHelper(): void {}
`,
			'utf8',
		);

		writeFileSync(
			entry,
			`
export { formatLabel } from './impl.ts';
export const VERSION = '1';
`,
			'utf8',
		);

		const exports = collectExportsFromEntry(entry, dir);
		const names = exports.map((e) => e.name).sort();
		expect(names).toContain('formatLabel');
		expect(names).toContain('VERSION');
	});
});

describe('parseSizeFreezeEntries (TypeScript AST)', () => {
	it('reads maxLines from SIZE_FREEZE object literal', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ocx-slice-freeze-'));
		mkdirSync(dir, { recursive: true });
		const file = join(dir, 'file-size-budgets.ts');
		writeFileSync(
			file,
			`
export const SIZE_FREEZE: Record<string, { maxLines: number; reason: string }> = {
  "apps/ui-xr/src/main.ts": { maxLines: 10255, reason: "god-file" },
  'apps/api/src/app.ts': { maxLines: 900, reason: "split later" },
};
`,
			'utf8',
		);

		const entries = parseSizeFreezeEntries(file);
		expect(entries).toEqual(
			expect.arrayContaining([
				{ pathKey: 'apps/ui-xr/src/main.ts', maxLines: 10255 },
				{ pathKey: 'apps/api/src/app.ts', maxLines: 900 },
			]),
		);
	});
});
