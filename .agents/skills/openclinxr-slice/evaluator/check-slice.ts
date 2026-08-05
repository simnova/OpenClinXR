import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseCheckArgs, printCheckUsage } from './cli-utils.ts';
import { fileExists, getDefaultSliceRecordPath } from './utils.ts';

function runScript(scriptPath: string, args: string[]): number {
	const result = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...args], {
		cwd: process.cwd(),
		stdio: 'inherit',
	});

	if (result.error) {
		throw result.error;
	}

	return result.status ?? 1;
}

function main(): void {
	const args = parseCheckArgs(process.argv.slice(2));

	if (!args.sliceRoot) {
		printCheckUsage();
		process.exit(1);
	}

	const sliceRoot = resolve(args.sliceRoot);
	const outputPath = args.outputPath
		? resolve(args.outputPath)
		: joinPreferSliceLocal(sliceRoot);
	const initScriptPath = fileURLToPath(new URL('./init-slice-record.ts', import.meta.url));
	const evaluateScriptPath = fileURLToPath(new URL('./evaluate-slice.ts', import.meta.url));

	if (!fileExists(outputPath) || args.forceInit) {
		console.log(`No slice record found. Creating scaffold at ${outputPath}`);
		const initArgs = ['--slice', sliceRoot, '--output', outputPath];
		if (args.forceInit) {
			initArgs.push('--force');
		}
		const initStatus = runScript(initScriptPath, initArgs);
		if (initStatus !== 0) {
			process.exit(initStatus);
		}
		console.log('Slice record scaffold created. Replace the TODO sections, then re-run the check.');
	}

	if (args.initOnly) {
		process.exit(0);
	}

	const evaluateArgs = ['--slice', sliceRoot, '--output', outputPath];
	if (args.json) {
		evaluateArgs.push('--json');
	}

	const evaluateStatus = runScript(evaluateScriptPath, evaluateArgs);
	process.exit(evaluateStatus);
}

function joinPreferSliceLocal(sliceRoot: string): string {
	const local = resolve(sliceRoot, 'slice-record.md');
	if (fileExists(local)) {
		return local;
	}
	return getDefaultSliceRecordPath(sliceRoot);
}

main();
