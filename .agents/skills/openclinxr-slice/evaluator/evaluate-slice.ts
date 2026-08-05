/**
 * Rubric-scored OpenClinXR work-slice evaluator.
 *
 * Scores ARTIFACTS on disk (slice record + packages + evidence + guardrail
 * files), not agent claims. Weighted checks with critical flags and a numeric
 * pass threshold. TypeScript surfaces are read via the compiler API (ts-ast.ts).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { parseEvaluateArgs, printEvaluateUsage } from './cli-utils.ts';
import {
	extractPathReferences,
	isTemplateBoilerplate,
	parseMarkdownSections,
} from './markdown-utils.ts';
import {
	collectExportsFromEntry,
	findExemptionSurfaces,
	parseSizeFreezeEntries,
	resolvePackageEntryFiles,
	type ExportDeclarationInfo,
} from './ts-ast.ts';
import { directoryExists, fileExists, getDefaultSliceRecordPath } from './utils.ts';

const requiredSliceSections = [
	'what changed',
	'evidence passed',
	'remaining risk',
	'validation performed',
] as const;

const checkDefinitions = [
	{
		id: 'required_slice_sections',
		weight: 3,
		critical: true,
		description:
			'Slice record states what changed, what evidence passed, remaining risk, and validation — with non-boilerplate content.',
	},
	{
		id: 'evidence_refs_exist',
		weight: 4,
		critical: true,
		description:
			'Verification claims in the slice record reference evidence paths that exist on disk under the slice root.',
	},
	{
		id: 'touched_packages_tested',
		weight: 4,
		critical: true,
		description:
			'Touched packages under packages/ have test files, and public exports (AST) appear in those suites.',
	},
	{
		id: 'no_guardrail_weakening',
		weight: 4,
		critical: true,
		description:
			'No SIZE_FREEZE ceiling was raised vs baseline; no architecture-rule exemption surface was added.',
	},
	{
		id: 'claim_safety_language',
		weight: 3,
		critical: true,
		description:
			'Slice record avoids unfenced clinical-validity, exam-equivalence, licensure, or scoring-claim language.',
	},
] as const;

const maxScore = checkDefinitions.reduce((total, check) => total + check.weight, 0);
const passingScore = 15;

type CheckId = (typeof checkDefinitions)[number]['id'];

interface CheckResult {
	id: CheckId;
	weight: number;
	critical: boolean;
	description: string;
	passed: boolean;
	details: string[];
}

interface EvaluationResult {
	label: string;
	sliceRoot: string;
	recordPath: string;
	totalScore: number;
	maxScore: number;
	passingScore: number;
	overallStatus: 'pass' | 'fail';
	failedChecks: CheckId[];
	checks: CheckResult[];
}

interface ExpectedReport {
	overallStatus: 'pass' | 'fail';
	failedChecks: CheckId[];
}

function readText(filePath: string): string {
	return readFileSync(filePath, 'utf8');
}

function readJson<T>(filePath: string): T {
	return JSON.parse(readText(filePath)) as T;
}

function listFiles(root: string): string[] {
	const files: string[] = [];
	if (!directoryExists(root)) {
		return files;
	}

	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === 'dist') {
			continue;
		}
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...listFiles(fullPath));
			continue;
		}
		files.push(fullPath);
	}

	return files;
}

function createCheckResult(id: CheckId, passed: boolean, details: string[]): CheckResult {
	const definition = checkDefinitions.find((check) => check.id === id);
	if (!definition) {
		throw new Error(`Unknown check id: ${id}`);
	}
	return {
		critical: definition.critical,
		description: definition.description,
		details,
		id,
		passed,
		weight: definition.weight,
	};
}

function evaluateRequiredSliceSections(recordText: string): CheckResult {
	const sections = parseMarkdownSections(recordText);
	const missing = requiredSliceSections.filter((heading) => {
		const content = sections.get(heading);
		return !content || content.length < 30 || isTemplateBoilerplate(content);
	});

	return createCheckResult(
		'required_slice_sections',
		missing.length === 0,
		missing.length === 0
			? ['All required slice sections are present with meaningful content.']
			: [`Missing, thin, or boilerplate sections: ${missing.join(', ')}.`],
	);
}

/**
 * Evidence / validation sections must cite paths that resolve under the slice root.
 * Pure shell commands (pnpm …) are ignored by extractPathReferences.
 */
function evaluateEvidenceRefsExist(sliceRoot: string, recordText: string): CheckResult {
	const sections = parseMarkdownSections(recordText);
	const evidenceBodies = [
		sections.get('evidence passed') ?? '',
		sections.get('validation performed') ?? '',
	].join('\n');

	const refs = extractPathReferences(evidenceBodies);
	if (refs.length === 0) {
		return createCheckResult('evidence_refs_exist', false, [
			'No filesystem evidence paths were cited under Evidence passed / Validation performed.',
		]);
	}

	const missing: string[] = [];
	const present: string[] = [];

	for (const ref of refs) {
		const cleaned = ref.replace(/^\.\//, '');
		const candidates = [
			join(sliceRoot, cleaned),
			resolve(sliceRoot, cleaned),
			// allow absolute-within-slice style "evidence/foo.txt"
			join(sliceRoot, ref),
		];
		if (candidates.some((c) => fileExists(c))) {
			present.push(ref);
		} else {
			missing.push(ref);
		}
	}

	return createCheckResult(
		'evidence_refs_exist',
		missing.length === 0 && present.length > 0,
		missing.length === 0
			? [`All ${present.length} cited evidence path(s) exist on disk.`]
			: [
					`Fabricated or missing evidence path(s): ${missing.join(', ')}.`,
					...(present.length > 0 ? [`Present: ${present.join(', ')}.`] : []),
				],
	);
}

function listPackageRoots(sliceRoot: string): string[] {
	const packagesDir = join(sliceRoot, 'packages');
	if (!directoryExists(packagesDir)) {
		return [];
	}
	return readdirSync(packagesDir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => join(packagesDir, e.name))
		.sort();
}

function isTestFile(filePath: string): boolean {
	return /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

function exportMentionedInTests(exportName: string, testSources: string[]): boolean {
	// Suite structure check — not export parsing. AST already found the export name.
	const patterns = [
		new RegExp(String.raw`\bdescribe\s*\(\s*['"\`][^'"\`]*\b${escapeRegExpLiteral(exportName)}\b`),
		new RegExp(String.raw`\bit\s*\(\s*['"\`][^'"\`]*\b${escapeRegExpLiteral(exportName)}\b`),
		new RegExp(String.raw`\b${escapeRegExpLiteral(exportName)}\s*\(`),
	];
	return testSources.some((source) => patterns.some((p) => p.test(source)));
}

function escapeRegExpLiteral(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isFunctionLikeKind(kind: string): boolean {
	return (
		kind === 'FunctionDeclaration' ||
		kind === 'VariableDeclaration' ||
		kind === 'ClassDeclaration' ||
		kind === 'ExportAssignment'
	);
}

function evaluateTouchedPackagesTested(sliceRoot: string): CheckResult {
	const packageRoots = listPackageRoots(sliceRoot);
	// architecture-rules is guardrail surface — skip test-coverage requirement for it
	const codePackages = packageRoots.filter((p) => !/architecture-rules[/\\]?$/.test(p) && !p.endsWith('architecture-rules'));

	if (codePackages.length === 0) {
		// No code packages: pass only if no packages/ at all is OK for pure-docs slices
		if (packageRoots.length === 0) {
			return createCheckResult('touched_packages_tested', true, [
				'No packages/ tree under slice root — package test coverage not applicable.',
			]);
		}
		return createCheckResult('touched_packages_tested', true, [
			'Only architecture-rules package present; no application package test coverage required.',
		]);
	}

	const violations: string[] = [];
	let packagesChecked = 0;

	for (const packageRoot of codePackages) {
		packagesChecked += 1;
		const packageJsonPath = join(packageRoot, 'package.json');
		const packageJson = fileExists(packageJsonPath)
			? (readJson<Record<string, unknown>>(packageJsonPath) as Record<string, unknown>)
			: {};

		const testFiles = listFiles(packageRoot).filter(isTestFile);
		if (testFiles.length === 0) {
			violations.push(`${relative(sliceRoot, packageRoot)} has no test files.`);
			continue;
		}

		const entryFiles = resolvePackageEntryFiles(packageRoot, packageJson);
		if (entryFiles.length === 0) {
			violations.push(`${relative(sliceRoot, packageRoot)} has no resolvable public entry file.`);
			continue;
		}

		const publicExports: ExportDeclarationInfo[] = [];
		for (const entry of entryFiles) {
			publicExports.push(...collectExportsFromEntry(entry, packageRoot));
		}

		const named = [
			...new Set(
				publicExports
					.filter((e) => e.name !== 'default' && isFunctionLikeKind(e.kind))
					.map((e) => e.name),
			),
		];

		const testSources = testFiles.map((f) => readText(f));
		for (const exportName of named) {
			if (!exportMentionedInTests(exportName, testSources)) {
				violations.push(
					`Public export ${exportName} in ${relative(sliceRoot, packageRoot)} is not exercised in tests.`,
				);
			}
		}
	}

	return createCheckResult(
		'touched_packages_tested',
		violations.length === 0,
		violations.length === 0
			? [`Checked ${packagesChecked} package(s): tests present and public exports covered.`]
			: violations,
	);
}

function findFilesByBasename(root: string, basename: string): string[] {
	return listFiles(root).filter((f) => f.endsWith(`/${basename}`) || f.endsWith(`\\${basename}`));
}

function evaluateNoGuardrailWeakening(sliceRoot: string): CheckResult {
	const details: string[] = [];

	// SIZE_FREEZE ratchet: compare current vs baseline via AST
	const freezeFiles = findFilesByBasename(sliceRoot, 'file-size-budgets.ts');
	for (const freezeFile of freezeFiles) {
		const baselinePath = freezeFile.replace(/\.ts$/, '.baseline.ts');
		if (!fileExists(baselinePath)) {
			// Also accept sibling file-size-budgets.baseline.ts
			continue;
		}
		const current = parseSizeFreezeEntries(freezeFile);
		const baseline = parseSizeFreezeEntries(baselinePath);
		const baselineMap = new Map(baseline.map((e) => [e.pathKey, e.maxLines]));

		for (const entry of current) {
			const prev = baselineMap.get(entry.pathKey);
			if (prev !== undefined && entry.maxLines > prev) {
				details.push(
					`SIZE_FREEZE ceiling raised for ${entry.pathKey}: ${prev} → ${entry.maxLines} (split the file instead).`,
				);
			}
			if (prev === undefined) {
				// New grandfather entry is a form of weakening when added without paydown
				details.push(
					`SIZE_FREEZE added new grandfather entry for ${entry.pathKey} at maxLines=${entry.maxLines}.`,
				);
			}
		}
	}

	// Explicit baseline naming: file-size-budgets.baseline.ts next to current
	const baselineNamed = listFiles(sliceRoot).filter((f) => f.endsWith('file-size-budgets.baseline.ts'));
	for (const baselinePath of baselineNamed) {
		const currentPath = baselinePath.replace(/\.baseline\.ts$/, '.ts');
		if (!fileExists(currentPath)) {
			continue;
		}
		const current = parseSizeFreezeEntries(currentPath);
		const baseline = parseSizeFreezeEntries(baselinePath);
		const baselineMap = new Map(baseline.map((e) => [e.pathKey, e.maxLines]));
		for (const entry of current) {
			const prev = baselineMap.get(entry.pathKey);
			if (prev !== undefined && entry.maxLines > prev) {
				const msg = `SIZE_FREEZE ceiling raised for ${entry.pathKey}: ${prev} → ${entry.maxLines} (split the file instead).`;
				if (!details.includes(msg)) {
					details.push(msg);
				}
			}
		}
	}

	// Architecture exemption surfaces in any .ts under packages/architecture-rules
	const archRoots = listPackageRoots(sliceRoot).filter((p) => p.includes('architecture-rules'));
	for (const archRoot of archRoots) {
		for (const file of listFiles(archRoot).filter((f) => f.endsWith('.ts') && !f.endsWith('.baseline.ts'))) {
			const hits = findExemptionSurfaces(file);
			for (const hit of hits) {
				details.push(`Architecture exemption surface in ${relative(sliceRoot, file)}: ${hit}.`);
			}
		}
	}

	return createCheckResult(
		'no_guardrail_weakening',
		details.length === 0,
		details.length === 0
			? ['No SIZE_FREEZE ceiling raises or architecture exemption surfaces detected.']
			: details,
	);
}

/**
 * Claim-safety: fail on unfenced promotion language.
 * Negated / quoted-as-forbidden forms (e.g. "not exam-equivalent") are allowed.
 */
function evaluateClaimSafetyLanguage(recordText: string): CheckResult {
	// Strip fenced code blocks so example counter-claims in code don't trip the check
	const withoutFences = recordText.replace(/```[\s\S]*?```/g, '\n');
	const lines = withoutFences.split('\n');

	const forbidden = [
		{ id: 'exam-equivalence', re: /\bexam[- ]equivalent\b/i },
		{ id: 'clinical-validity', re: /\bclinical(?:ly)?\s+valid(?:ity|ated)?\b/i },
		{ id: 'licensure', re: /\blicensure\b/i },
		{ id: 'board-scoring', re: /\b(?:board[- ]?(?:pass|score)|pass(?:ing)?\s+score\s+for\s+(?:the\s+)?board)\b/i },
		{ id: 'diagnostic-claim', re: /\bdiagnos(?:is|es|tic\s+accuracy)\b/i },
		{ id: 'quest-readiness', re: /\bquest\s+(?:3\s+)?ready\b/i },
	];

	const hits: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		// Allow explicit negations / policy restatements
		if (
			/\bnot\b/i.test(trimmed) ||
			/\bmust not\b/i.test(trimmed) ||
			/\bno\b.+\bclaims?\b/i.test(trimmed) ||
			/\bavoid\b/i.test(trimmed) ||
			/\bforbidden\b/i.test(trimmed) ||
			/\bnever\b/i.test(trimmed) ||
			/\bgate(?:s)?\s+stay\s+false\b/i.test(trimmed)
		) {
			continue;
		}

		for (const rule of forbidden) {
			if (rule.re.test(trimmed)) {
				hits.push(`${rule.id}: "${trimmed.slice(0, 120)}"`);
			}
		}
	}

	return createCheckResult(
		'claim_safety_language',
		hits.length === 0,
		hits.length === 0
			? ['No unfenced clinical/scoring/exam-equivalence claim language detected.']
			: [`Unsafe claim language: ${hits.join('; ')}.`],
	);
}

function evaluateSlice(label: string, sliceRoot: string, recordPath: string): EvaluationResult {
	if (!fileExists(recordPath)) {
		throw new Error(`Slice record not found: ${recordPath}`);
	}

	const recordText = readText(recordPath);
	const checks = [
		evaluateRequiredSliceSections(recordText),
		evaluateEvidenceRefsExist(sliceRoot, recordText),
		evaluateTouchedPackagesTested(sliceRoot),
		evaluateNoGuardrailWeakening(sliceRoot),
		evaluateClaimSafetyLanguage(recordText),
	];

	const totalScore = checks.reduce((total, check) => total + (check.passed ? check.weight : 0), 0);
	const failedChecks = checks.filter((check) => !check.passed).map((check) => check.id);
	const hasCriticalFailure = checks.some((check) => check.critical && !check.passed);

	return {
		checks,
		failedChecks,
		label,
		maxScore,
		overallStatus: !hasCriticalFailure && totalScore >= passingScore ? 'pass' : 'fail',
		passingScore,
		recordPath,
		sliceRoot,
		totalScore,
	};
}

function compareExpected(
	result: EvaluationResult,
	expected: ExpectedReport,
): { matches: boolean; problems: string[] } {
	const actualFailed = [...result.failedChecks].sort();
	const expectedFailed = [...expected.failedChecks].sort();
	const problems: string[] = [];

	if (result.overallStatus !== expected.overallStatus) {
		problems.push(`Expected overall status ${expected.overallStatus} but got ${result.overallStatus}.`);
	}
	if (JSON.stringify(actualFailed) !== JSON.stringify(expectedFailed)) {
		problems.push(
			`Expected failed checks [${expectedFailed.join(', ')}] but got [${actualFailed.join(', ')}].`,
		);
	}

	return { matches: problems.length === 0, problems };
}

function formatResult(result: EvaluationResult): string {
	const lines = [
		`${result.label}: ${result.overallStatus.toUpperCase()} (${result.totalScore}/${result.maxScore}, pass≥${result.passingScore})`,
	];

	for (const check of result.checks) {
		lines.push(
			`- [${check.passed ? 'pass' : 'fail'}] ${check.id} (${check.passed ? check.weight : 0}/${check.weight}${check.critical ? ', critical' : ''})`,
		);
		for (const detail of check.details) {
			lines.push(`  ${detail}`);
		}
	}

	return lines.join('\n');
}

function evaluateFixture(
	fixtureDir: string,
	verifyExpected: boolean,
): {
	result: EvaluationResult;
	comparison?: { matches: boolean; problems: string[] };
} {
	const sliceRoot = join(fixtureDir, 'slice');
	const recordPath = join(fixtureDir, 'slice-record.md');
	const result = evaluateSlice(relative(process.cwd(), fixtureDir), sliceRoot, recordPath);

	if (!verifyExpected) {
		return { result };
	}

	const expectedPath = join(fixtureDir, 'expected-report.json');
	if (!fileExists(expectedPath)) {
		throw new Error(`Expected report not found: ${expectedPath}`);
	}

	return {
		comparison: compareExpected(result, readJson<ExpectedReport>(expectedPath)),
		result,
	};
}

function getFixtureDirectories(fixturesRoot: string): string[] {
	return readdirSync(fixturesRoot)
		.map((entry) => join(fixturesRoot, entry))
		.filter((entryPath) => directoryExists(entryPath))
		.sort();
}

function main(): void {
	const args = parseEvaluateArgs(process.argv.slice(2));

	if (args.fixturesRoot) {
		const fixtureDirs = getFixtureDirectories(resolve(args.fixturesRoot));
		const results = fixtureDirs.map((fixtureDir) => evaluateFixture(fixtureDir, args.verifyExpected));
		const mismatches = results.filter((entry) => entry.comparison && !entry.comparison.matches);

		if (args.json) {
			console.log(
				JSON.stringify(
					results.map((entry) => ({
						comparison: entry.comparison ?? null,
						result: entry.result,
					})),
					null,
					2,
				),
			);
		} else {
			for (const entry of results) {
				console.log(formatResult(entry.result));
				if (entry.comparison) {
					console.log(
						entry.comparison.matches
							? '  Expected report matched.'
							: `  Expected report mismatch: ${entry.comparison.problems.join(' ')}`,
					);
				}
			}
		}

		process.exit(mismatches.length === 0 ? 0 : 1);
	}

	if (args.fixtureDir) {
		const evaluation = evaluateFixture(resolve(args.fixtureDir), args.verifyExpected);

		if (args.json) {
			console.log(JSON.stringify(evaluation, null, 2));
		} else {
			console.log(formatResult(evaluation.result));
			if (evaluation.comparison) {
				console.log(
					evaluation.comparison.matches
						? 'Expected report matched.'
						: `Expected report mismatch: ${evaluation.comparison.problems.join(' ')}`,
				);
			}
		}

		process.exit(
			evaluation.comparison
				? evaluation.comparison.matches
					? 0
					: 1
				: evaluation.result.overallStatus === 'pass'
					? 0
					: 1,
		);
	}

	if (args.sliceRoot) {
		const resolvedSliceRoot = resolve(args.sliceRoot);
		const recordPath = args.outputPath
			? resolve(args.outputPath)
			: join(resolvedSliceRoot, 'slice-record.md');
		const fallback = getDefaultSliceRecordPath(resolvedSliceRoot);
		const effectiveRecord = fileExists(recordPath)
			? recordPath
			: fileExists(fallback)
				? fallback
				: recordPath;

		const result = evaluateSlice(
			relative(process.cwd(), resolvedSliceRoot),
			resolvedSliceRoot,
			effectiveRecord,
		);

		if (args.json) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			console.log(formatResult(result));
		}

		process.exit(result.overallStatus === 'pass' ? 0 : 1);
	}

	printEvaluateUsage();
	process.exit(1);
}

main();
