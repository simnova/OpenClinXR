import { existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

export function fileExists(filePath: string): boolean {
	return existsSync(filePath) && statSync(filePath).isFile();
}

export function directoryExists(filePath: string): boolean {
	return existsSync(filePath) && statSync(filePath).isDirectory();
}

/** Default path for a slice record under the skill runs/ tree. */
export function getDefaultSliceRecordPath(sliceRoot: string): string {
	const resolved = resolve(sliceRoot);
	const relativeSlicePath = relative(process.cwd(), resolved);

	if (relativeSlicePath.startsWith('..')) {
		throw new Error(
			`Slice path ${resolved} is outside the current working directory.\n` +
				`Run from the repo root, or pass --output to set the slice record path explicitly.`,
		);
	}

	return join(process.cwd(), '.agents/skills/openclinxr-slice/runs', relativeSlicePath, 'slice-record.md');
}
