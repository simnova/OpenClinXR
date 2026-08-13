import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * #92 — `pnpm test --force` must reach the inner turbo invocation.
 *
 * The top-level gate is a chained script:
 *
 *   "test": "pnpm //#test:tools && pnpm packages:test"
 *
 * `pnpm test --force` appends `--force` to the END of that script string, so it lands
 * on the last chain segment (`pnpm packages:test --force`) and, via pnpm's own arg
 * forwarding, on the turbo command the segment runs. That forwarding is implicit and
 * version-dependent, so `test:force` is the DOCUMENTED EQUIVALENT: the `--force` flag
 * is written directly into the turbo invocation it runs
 * (`packages:test:force` = `... turbo run test --force ...`), with no reliance on
 * pnpm's append behaviour at all.
 *
 * This test asserts the COMPOSED COMMAND — the actual script strings chained by
 * package.json — never a cache observation. A cache-miss observation passes trivially
 * on a cold cache and says nothing about whether `--force` reached turbo.
 */

function readScripts(): Record<string, string> {
  const rootPackage = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  return rootPackage.scripts;
}

const scripts = readScripts();

/** Compose the command pnpm runs for `pnpm <script> [args...]`: args are appended to the end. */
function compose(scriptName: string, args: readonly string[]): string {
  const base = scripts[scriptName];
  if (base === undefined) throw new Error(`script ${scriptName} is missing from package.json`);
  return args.length > 0 ? `${base} ${args.join(" ")}` : base;
}

/** Resolve `pnpm <script>` references inside a composed chain to the referenced script text. */
function resolvePnpmRefs(command: string): string {
  return command.replace(/pnpm (\S+)/g, (whole, name: string) => scripts[name] ?? whole);
}

/** The turbo segment of a composed chain: the segment that invokes `turbo run test`. */
function turboSegment(command: string): string {
  return command
    .split("&&")
    .map((segment) => segment.trim())
    .find((segment) => resolvePnpmRefs(segment).includes("turbo run test"))!;
}

describe("the --force cache-buster reaches the inner turbo invocation (#92)", () => {
  it("documents the equivalent: test:force runs the turbo test task with --force written in", () => {
    expect(scripts["test:force"]).toBe("pnpm //#test:tools && pnpm packages:test:force");
    expect(scripts["packages:test:force"]).toContain("turbo run test");
    expect(scripts["packages:test:force"]).toContain("--force");
    // the flag sits on the turbo invocation, before the filters, not on some other tool
    const turboPart = scripts["packages:test:force"].split("turbo run test")[1]!;
    expect(turboPart.indexOf("--force")).toBeLessThan(turboPart.indexOf("--filter"));
  });

  it("composes pnpm test --force so --force lands on the turbo invocation", () => {
    const composed = resolvePnpmRefs(compose("test", ["--force"]));
    expect(turboSegment(composed)).toContain("turbo run test");
    expect(turboSegment(composed)).toContain("--force");
  });

  it("does not put --force on the turbo invocation without the flag (non-vacuous)", () => {
    const composed = resolvePnpmRefs(compose("test", []));
    expect(turboSegment(composed)).toContain("turbo run test");
    expect(turboSegment(composed)).not.toContain("--force");
  });

  it("keeps packages:test:force identical to packages:test apart from the --force flag", () => {
    expect(scripts["packages:test:force"]).toBe(
      scripts["packages:test"].replace("turbo run test ", "turbo run test --force "),
    );
  });
});
