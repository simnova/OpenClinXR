/**
 * TypeScript AST helpers for the openclinxr-slice evaluator.
 *
 * CRITICAL: Use the TypeScript compiler API — never regex-over-source for
 * export discovery, re-exports, or SIZE_FREEZE structure. Upstream cellix-tdd
 * used regex and its own rubric admitted multi-line / overload / re-export
 * mis-parses.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { fileExists } from './utils.ts';

export interface ExportDeclarationInfo {
	filePath: string;
	name: string;
	kind: string;
	hasDoc: boolean;
	docText: string;
}

export interface SizeFreezeEntry {
	pathKey: string;
	maxLines: number;
}

function readText(filePath: string): string {
	return readFileSync(filePath, 'utf8');
}

function createSourceFile(filePath: string): ts.SourceFile {
	const text = readText(filePath);
	return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function getJsDocText(node: ts.Node): string {
	const parts: string[] = [];
	const docs = ts.getJSDocCommentsAndTags(node);
	for (const doc of docs) {
		if (ts.isJSDoc(doc)) {
			const comment = doc.comment;
			if (typeof comment === 'string') {
				parts.push(comment);
			} else if (Array.isArray(comment)) {
				for (const item of comment) {
					if (typeof item === 'string') {
						parts.push(item);
					} else if (item && typeof item === 'object' && 'text' in item) {
						parts.push(String((item as { text: string }).text));
					}
				}
			}
		}
	}
	// Also check leading comment ranges for /** */ immediately preceding
	const sf = node.getSourceFile();
	const fullStart = node.getFullStart();
	const ranges = ts.getLeadingCommentRanges(sf.text, fullStart) ?? [];
	for (const range of ranges) {
		const text = sf.text.slice(range.pos, range.end);
		if (text.startsWith('/**')) {
			parts.push(text);
		}
	}
	return parts.join('\n').trim();
}

function hasExportModifier(node: ts.Node): boolean {
	const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
	return Boolean(modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function resolveModuleFile(fromFile: string, moduleSpecifier: string): string | null {
	if (!moduleSpecifier.startsWith('.')) {
		return null;
	}
	const base = resolve(dirname(fromFile), moduleSpecifier);
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		`${base}.js`,
		`${base}.jsx`,
		join(base, 'index.ts'),
		join(base, 'index.tsx'),
		join(base, 'index.js'),
	];
	for (const candidate of candidates) {
		if (fileExists(candidate)) {
			return candidate;
		}
	}
	return null;
}

/**
 * Collect named public exports from an entry file via the TypeScript AST,
 * following relative re-exports.
 */
export function collectExportsFromEntry(
	entryFile: string,
	packageRoot: string,
	visited: Set<string> = new Set(),
): ExportDeclarationInfo[] {
	if (visited.has(entryFile) || !fileExists(entryFile)) {
		return [];
	}
	visited.add(entryFile);

	const sourceFile = createSourceFile(entryFile);
	const results: ExportDeclarationInfo[] = [];

	const pushDecl = (name: string, kind: string, node: ts.Node) => {
		const docText = getJsDocText(node);
		results.push({
			filePath: entryFile,
			name,
			kind,
			hasDoc: docText.length > 0,
			docText,
		});
	};

	const visit = (node: ts.Node): void => {
		// export function / class / interface / type / enum
		if (
			(ts.isFunctionDeclaration(node) ||
				ts.isClassDeclaration(node) ||
				ts.isInterfaceDeclaration(node) ||
				ts.isTypeAliasDeclaration(node) ||
				ts.isEnumDeclaration(node)) &&
			hasExportModifier(node) &&
			node.name
		) {
			const kind = ts.SyntaxKind[node.kind] ?? 'unknown';
			pushDecl(node.name.text, kind, node);
		}

		// export const/let/var name = ...
		if (ts.isVariableStatement(node) && hasExportModifier(node)) {
			for (const decl of node.declarationList.declarations) {
				if (ts.isIdentifier(decl.name)) {
					pushDecl(decl.name.text, 'VariableDeclaration', node);
				}
			}
		}

		// export default ...
		if (ts.isExportAssignment(node) && !node.isExportEquals) {
			pushDecl('default', 'ExportAssignment', node);
		}

		// export { a, b as c } from './x'  OR  export { a }
		if (ts.isExportDeclaration(node)) {
			const moduleSpecifier =
				node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
					? node.moduleSpecifier.text
					: null;

			if (node.exportClause && ts.isNamedExports(node.exportClause)) {
				if (moduleSpecifier?.startsWith('.')) {
					const resolved = resolveModuleFile(entryFile, moduleSpecifier);
					if (resolved && isUnder(resolved, packageRoot)) {
						const sourceExports = collectExportsFromEntry(resolved, packageRoot, visited);
						for (const element of node.exportClause.elements) {
							const originalName = element.propertyName?.text ?? element.name.text;
							const exportedName = element.name.text;
							const source = sourceExports.find((e) => e.name === originalName);
							if (source) {
								results.push({ ...source, name: exportedName });
							} else {
								const docText = getJsDocText(element);
								results.push({
									filePath: resolved,
									name: exportedName,
									kind: 'ReExport',
									hasDoc: docText.length > 0,
									docText,
								});
							}
						}
					}
				} else if (!moduleSpecifier) {
					// export { localName }
					for (const element of node.exportClause.elements) {
						pushDecl(element.name.text, 'NamedExport', element);
					}
				}
			}

			// export * from './x'
			if (!node.exportClause && moduleSpecifier?.startsWith('.')) {
				const resolved = resolveModuleFile(entryFile, moduleSpecifier);
				if (resolved && isUnder(resolved, packageRoot)) {
					results.push(...collectExportsFromEntry(resolved, packageRoot, visited));
				}
			}

			// export * as ns from './x' — count namespace as one export
			if (node.exportClause && ts.isNamespaceExport(node.exportClause) && moduleSpecifier) {
				pushDecl(node.exportClause.name.text, 'NamespaceExport', node);
			}
		}

		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return results;
}

function isUnder(childPath: string, parentPath: string): boolean {
	const rel = relative(parentPath, childPath);
	return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith('../');
}

/**
 * Parse a SIZE_FREEZE-like object literal from a TypeScript source file via AST.
 * Looks for: `export const SIZE_FREEZE = { "path": { maxLines: N, ... }, ... }`
 */
export function parseSizeFreezeEntries(filePath: string): SizeFreezeEntry[] {
	if (!fileExists(filePath)) {
		return [];
	}

	const sourceFile = createSourceFile(filePath);
	const entries: SizeFreezeEntry[] = [];

	const visit = (node: ts.Node): void => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === 'SIZE_FREEZE' &&
			node.initializer &&
			ts.isObjectLiteralExpression(node.initializer)
		) {
			for (const prop of node.initializer.properties) {
				if (!ts.isPropertyAssignment(prop)) {
					continue;
				}
				const pathKey = propertyNameText(prop.name);
				if (!pathKey) {
					continue;
				}
				const maxLines = extractMaxLines(prop.initializer);
				if (maxLines !== null) {
					entries.push({ pathKey, maxLines });
				}
			}
		}
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return entries;
}

function propertyNameText(name: ts.PropertyName): string | null {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) {
		return name.expression.text;
	}
	return null;
}

function extractMaxLines(initializer: ts.Expression): number | null {
	if (!ts.isObjectLiteralExpression(initializer)) {
		return null;
	}
	for (const prop of initializer.properties) {
		if (!ts.isPropertyAssignment(prop)) {
			continue;
		}
		const key = propertyNameText(prop.name);
		if (key !== 'maxLines') {
			continue;
		}
		if (ts.isNumericLiteral(prop.initializer)) {
			return Number(prop.initializer.text);
		}
		// unary minus etc.
		if (
			ts.isPrefixUnaryExpression(prop.initializer) &&
			prop.initializer.operator === ts.SyntaxKind.MinusToken &&
			ts.isNumericLiteral(prop.initializer.operand)
		) {
			return -Number(prop.initializer.operand.text);
		}
	}
	return null;
}

/**
 * Detect architecture-rule exemption additions via AST.
 * Flags: properties named like `exemptions` / `allowlist` / `exemptFiles`
 * whose array literals gain string elements (heuristic: any non-empty array
 * under those names in the evaluated file is treated as an exemption surface).
 */
export function findExemptionSurfaces(filePath: string): string[] {
	if (!fileExists(filePath)) {
		return [];
	}

	const sourceFile = createSourceFile(filePath);
	const hits: string[] = [];
	const exemptName = /^(exemptions?|allowlist|exemptFiles|ignoreFiles|architectureExemptions)$/i;

	const visit = (node: ts.Node): void => {
		if (ts.isPropertyAssignment(node)) {
			const key = propertyNameText(node.name);
			if (key && exemptName.test(key)) {
				if (ts.isArrayLiteralExpression(node.initializer) && node.initializer.elements.length > 0) {
					hits.push(`${key} (${node.initializer.elements.length} entries)`);
				}
			}
		}
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			exemptName.test(node.name.text) &&
			node.initializer &&
			ts.isArrayLiteralExpression(node.initializer) &&
			node.initializer.elements.length > 0
		) {
			hits.push(`${node.name.text} (${node.initializer.elements.length} entries)`);
		}
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return hits;
}

/**
 * Resolve package entry files from package.json exports / main / types via plain JSON
 * (not TS AST — package.json is JSON).
 */
export function resolvePackageEntryFiles(
	packageRoot: string,
	packageJson: Record<string, unknown>,
): string[] {
	const entries = new Set<string>();

	const tryAdd = (target: string) => {
		const resolved = resolveModuleFile(join(packageRoot, 'package.json'), target.startsWith('.') ? target : `./${target}`);
		// resolveModuleFile uses dirname(fromFile)=packageRoot for ./ paths via join
		const candidates = [
			resolve(packageRoot, target),
			resolve(packageRoot, `${target}.ts`),
			resolve(packageRoot, `${target}.tsx`),
			join(resolve(packageRoot, target), 'index.ts'),
		];
		// Also handle "./src/index.ts" style
		const base = resolve(packageRoot, target);
		const more = [
			base,
			`${base}.ts`,
			`${base}.tsx`,
			join(base, 'index.ts'),
		];
		for (const c of [...candidates, ...more, resolved].filter(Boolean) as string[]) {
			if (fileExists(c)) {
				entries.add(c);
			}
		}
	};

	const walkExports = (value: unknown): void => {
		if (typeof value === 'string') {
			tryAdd(value);
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				walkExports(item);
			}
			return;
		}
		if (value && typeof value === 'object') {
			for (const child of Object.values(value as Record<string, unknown>)) {
				walkExports(child);
			}
		}
	};

	if (packageJson.exports !== undefined) {
		walkExports(packageJson.exports);
	}
	if (typeof packageJson.main === 'string') {
		tryAdd(packageJson.main);
	}
	if (typeof packageJson.types === 'string') {
		tryAdd(packageJson.types);
	}

	// Fallback greenfield entry
	if (entries.size === 0) {
		for (const fallback of ['src/index.ts', 'index.ts', 'src/index.js']) {
			const full = join(packageRoot, fallback);
			if (fileExists(full)) {
				entries.add(full);
			}
		}
	}

	return [...entries];
}
