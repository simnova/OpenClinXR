
/**
 * Source counter for the `live:<file>` `done_when` rule (#570).
 *
 * Split out of done-when-rules.ts per the file-size ratchet (same seam note as done-when-tree.ts):
 * the rule evaluator owns dispatch, this owns the only nontrivial mechanic — counting PLANTED
 * `it.fails(` clauses without being fooled by prose.
 *
 * Why not a bare `/\bit\.fails\(/gu` over the raw source (the #570 harness column's own caveat):
 * a test file that DOCUMENTS the marker — in a comment, a report string, or a regex literal —
 * would over-count, and a worker whose plant went green would be refused forever. The scanner
 * below blanks comments and string-literal bodies before counting.
 *
 * CLAIM: counts `it . fails (` call sites in code, ignoring comments, '…', "…" and `…` bodies.
 * NOT TESTED HERE beyond the #570 contract: regex literals are treated as plain code (their
 * bodies are neither stripped nor counted unless they contain an unescaped `it.fails(`), nested
 * template-literal interpolations are not tracked, and `test.fails(` (vitest alias) is out of
 * scope — repo plants use `it.fails`, matching assert-contract-live.ts.
 */
export function countPlantedItFails(source: string): number {
  let code = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);
    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      // Keep the delimiters so surrounding code shape survives; blank the body.
      code += ch;
      i += 1;
      while (i < n && source[i] !== ch) {
        if (source[i] === "\\") i += 1; // skip the escaped character
        i += 1;
      }
      code += ch;
      i += 1;
      continue;
    }
    code += ch;
    i += 1;
  }
  return (code.match(/\bit\s*\.\s*fails\s*\(/gu) ?? []).length;
}
