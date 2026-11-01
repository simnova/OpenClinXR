import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// C23 RED (carried C20/C21 defects): probe-script.ts keeps the C20 branch
// rationale and the C3 three-intent comment that C21 dropped, each beside the
// code it explains; probe-c20.ts carries no type assertions.

function source(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

/** Comment text only, `//` and `*` stripped, whitespace collapsed. */
function commentsBetween(text: string, from: number, to: number): string {
  return text
    .slice(from, to)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("//") || line.startsWith("*") || line.startsWith("/*"))
    .map((line) => line.replace(/^(\/\/|\/\*\*?|\*\/?)\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ");
}

function typeAssertionCount(text: string): number {
  const file = ts.createSourceFile("probe.ts", text, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const isConst = ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(file) === "const";
      if (!isConst) count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

describe("C23 carried probe defects", () => {
  const script = source("probe-script.ts");

  it("keeps the C20 branch rationale inside the c20 branch, before runC20Script", () => {
    const branch = script.indexOf('deps.script === "c20"');
    const run = script.indexOf("runC20Script(", branch);
    expect(branch).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(branch);
    const comments = commentsBetween(script, branch, run);
    expect(comments).toContain("C20 scenario-rubric scoring: the lobby tiles (C12 flow verbatim), then every station in server order is replayed and scored against its own scenario rubric");
    expect(comments).toContain("probe-c20 owns and publishes window.__syncProbeC20 itself");
    expect(comments).toContain("The harness reads window.__syncProbe (harness-lib is shared and frozen); sync-probe.ts sits at its file-size ceiling and cannot grow a c20 field, so the C20 module attaches its data-only evidence here.");
  });

  it("keeps the C3 three-intent comment inside the actor loop, before the trigger", () => {
    const loop = script.indexOf("for (const actorId of PROBE_ACTOR_IDS)");
    const trigger = script.indexOf("learnerOpen ? 3 : 2", loop);
    expect(loop).toBeGreaterThan(-1);
    expect(trigger).toBeGreaterThan(loop);
    expect(commentsBetween(script, loop, trigger)).toContain(
      "C3 semantics: the second trigger first closes the learner's open utterance, so it sends 3 intents (end, select, start) instead of 2.",
    );
  });

  it("counts type assertions (control: the counter sees one in a known cast)", () => {
    expect(typeAssertionCount("const a = b as Foo; const c = [1] as const;")).toBe(1);
    expect(typeAssertionCount("const a = <Foo>b;")).toBe(1);
  });

  it("probe-c20.ts has no type assertions", () => {
    expect(typeAssertionCount(source("probe-c20.ts"))).toBe(0);
  });
});
