import process from 'node:process';

export interface EvaluateParsedArgs {
	fixtureDir?: string;
	fixturesRoot?: string;
	sliceRoot?: string;
	outputPath?: string;
	verifyExpected: boolean;
	json: boolean;
}

export function parseEvaluateArgs(argv: string[]): EvaluateParsedArgs {
	const parsed: EvaluateParsedArgs = {
		verifyExpected: false,
		json: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];

		switch (arg) {
			case '--':
				index = argv.length;
				break;
			case '--fixture':
				parsed.fixtureDir = next;
				index += 1;
				break;
			case '--fixtures-root':
				parsed.fixturesRoot = next;
				index += 1;
				break;
			case '--slice':
				parsed.sliceRoot = next;
				index += 1;
				break;
			case '--output':
				parsed.outputPath = next;
				index += 1;
				break;
			case '--verify-expected':
				parsed.verifyExpected = true;
				break;
			case '--json':
				parsed.json = true;
				break;
			case '--help':
				printEvaluateUsage();
				process.exit(0);
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return parsed;
}

export function printEvaluateUsage(): void {
	console.log(`Usage:
  node --experimental-strip-types .agents/skills/openclinxr-slice/evaluator/evaluate-slice.ts --fixture <fixture-dir> [--verify-expected] [--json]
  node --experimental-strip-types .agents/skills/openclinxr-slice/evaluator/evaluate-slice.ts --fixtures-root <fixtures-dir> --verify-expected [--json]
  node --experimental-strip-types .agents/skills/openclinxr-slice/evaluator/evaluate-slice.ts --slice <slice-root> [--output <slice-record.md>] [--json]`);
}

export interface CheckParsedArgs {
	forceInit: boolean;
	initOnly: boolean;
	json: boolean;
	outputPath?: string;
	sliceRoot?: string;
}

export function parseCheckArgs(argv: string[]): CheckParsedArgs {
	const parsed: CheckParsedArgs = {
		forceInit: false,
		initOnly: false,
		json: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];

		switch (arg) {
			case '--':
				index = argv.length;
				break;
			case '--slice':
				parsed.sliceRoot = next;
				index += 1;
				break;
			case '--output':
				parsed.outputPath = next;
				index += 1;
				break;
			case '--force-init':
				parsed.forceInit = true;
				break;
			case '--init-only':
				parsed.initOnly = true;
				break;
			case '--json':
				parsed.json = true;
				break;
			case '--help':
				printCheckUsage();
				process.exit(0);
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return parsed;
}

export function printCheckUsage(): void {
	console.log(`Usage:
  node --experimental-strip-types .agents/skills/openclinxr-slice/evaluator/check-slice.ts --slice <slice-root> [--output <slice-record.md>] [--init-only] [--force-init] [--json]`);
}
