import { readFileSync } from "node:fs";

/**
 * Assert that a PLANTED CONTRACT has been made live.
 *
 * The planted-contract pattern keeps main green while a contract is still unmet: `it.fails(...)`
 * passes for as long as its assertion is false. That is what lets an autonomous loop commit a RED
 * without blocking every later cycle on a red health gate.
 *
 * It also makes the obvious `done_when` proof VACUOUS. `run:vitest -t "<title>"` passes today, with
 * the behaviour unfixed, because the expected-fail counts as a pass. A worker that does nothing
 * satisfies it. The contract can only be trusted if something checks that the marker was removed.
 *
 * `run:` is argv-only with no shell, deliberately: "any proof that needs a pipe has to become a
 * SCRIPT COMMITTED TO GIT (reviewed code)" (done-when-rules.ts:104-106). This is that script.
 *
 * Encoded rather than eyeballed because the check had been done by hand twice — the four flips in
 * #25 and the two here. The rule in PROTO_VERIFY_DELEGATION.md is that a constraint verified by
 * hand twice becomes a check, otherwise human review stays load-bearing.
 *
 * Usage: tsx tools/openclinxr/openclaw/assert-contract-live.ts <testFile> <title>...
 *
 * CLAIM: fails while a named title is still `it.fails(`, or is absent/renamed; passes only when
 * every named title exists as a live `it(`.
 * NOT TESTED: that the test then PASSES — pair this with a `run:` of the suite, which is what the
 * done_when does. This checks the marker, not the outcome.
 */

export type ContractLiveResult = { ok: true } | { ok: false; problems: string[] };

/** Escape a title for use inside a RegExp — titles carry parentheses, quotes and punctuation. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function assertContractsLive(source: string, titles: readonly string[]): ContractLiveResult {
  const problems: string[] = [];

  for (const title of titles) {
    const escaped = escapeForRegExp(title);
    // Quote style is not fixed: the repo uses double quotes, but a worker may reformat.
    const quoted = `["'\`]${escaped}["'\`]`;
    const planted = new RegExp(`it\\s*\\.\\s*fails\\s*\\(\\s*${quoted}`, "u");
    const live = new RegExp(`(?<!\\.)\\bit\\s*\\(\\s*${quoted}`, "u");

    if (planted.test(source)) {
      problems.push(`still planted as it.fails: "${title}" — flip it to a live it() once the behaviour is fixed`);
      continue;
    }
    if (!live.test(source)) {
      problems.push(`no live it() found for: "${title}" — the contract was renamed or deleted rather than met`);
    }
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

function main(argv: readonly string[]): number {
  const [file, ...titles] = argv;
  if (!file || titles.length === 0) {
    console.error("usage: assert-contract-live.ts <testFile> <title>...");
    return 2;
  }

  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    console.error(`assert-contract-live: cannot read ${file}`);
    return 2;
  }

  const result = assertContractsLive(source, titles);
  if (result.ok) {
    console.log(`assert-contract-live: ${titles.length} contract(s) live in ${file}`);
    return 0;
  }
  for (const problem of result.problems) console.error(`assert-contract-live: ${problem}`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
