import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { directoryExists, fileExists, getDefaultSliceRecordPath } from './utils.ts';

interface ParsedArgs {
	force: boolean;
	outputPath?: string;
	sliceRoot?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
	const parsed: ParsedArgs = {
		force: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];

		switch (arg) {
			case '--':
				return parsed;
			case '--slice':
				parsed.sliceRoot = next;
				index += 1;
				break;
			case '--output':
				parsed.outputPath = next;
				index += 1;
				break;
			case '--force':
				parsed.force = true;
				break;
			case '--help':
				printUsage();
				process.exit(0);
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return parsed;
}

function printUsage(): void {
	console.log(`Usage:
  node --experimental-strip-types .agents/skills/openclinxr-slice/evaluator/init-slice-record.ts --slice <slice-root> [--output <slice-record.md>] [--force]`);
}

function readTemplate(): string {
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	return readFileSync(join(scriptDir, '../templates/slice-record-template.md'), 'utf8');
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));

	if (!args.sliceRoot) {
		printUsage();
		process.exit(1);
	}

	const sliceRoot = resolve(args.sliceRoot);
	if (!directoryExists(sliceRoot)) {
		throw new Error(`Slice directory not found: ${sliceRoot}`);
	}

	const outputPath = args.outputPath ? resolve(args.outputPath) : getDefaultSliceRecordPath(sliceRoot);

	if (fileExists(outputPath) && !args.force) {
		throw new Error(`Slice record already exists: ${outputPath}\nUse --force to overwrite it.`);
	}

	mkdirSync(dirname(outputPath), { recursive: true });

	const summary = readTemplate()
		.replaceAll('{{SLICE_ID}}', relative(process.cwd(), sliceRoot) || 'slice')
		.replaceAll('{{SLICE_PATH}}', relative(process.cwd(), sliceRoot))
		.replaceAll('{{RECORD_PATH}}', relative(process.cwd(), outputPath));

	writeFileSync(outputPath, summary, 'utf8');
	console.log(outputPath);
}

main();
