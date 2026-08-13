import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Drive channels are prose parsed by keyword match — one of three shipped literals silently
 * resolves to null (#362).
 *
 * MEASURED 2026-08-13 08:37, on the current bytes of `apps/ui-xr/src` + `packages/openclinxr`:
 *
 *   literal                                                  | resolves to
 *   ---------------------------------------------------------|------------
 *   gazeAversion: "on escalation from case triggers"         | 0.85   ("escalation" keyword)
 *   gazeAversion: "on family concern from case"              | null   <-- DEAD, the defect
 *   lipSyncViseme: "medium from hints"                       | 0.55   ("medium" keyword)
 *
 * These are the only three drive-channel string literals in the tree (four assignments in
 * `apps/ui-xr/src/runtime-state.ts`, three distinct values). The dead one describes exactly the
 * same kind of thing as the live one — a case-driven gaze cue — and differs only in wording:
 * "concern" is in no keyword list. `main.ts` resolves the eye/locomotion/viseme channels through
 * `generatedDriveScalar`, and `if (gaze !== null) applyGazeToHumanoid(...)` never fires for that
 * actor. The eye rig is present, wired, and correct (#337: `eye.L`/`eye.R` + per-actor iris on 3/3
 * MPFB actors, graded in pixels); for this case it is connected to nothing. Every static check
 * passes.
 *
 * WHY THIS IS A D9 DEFECT AND NOT A TYPO. The step is deterministic, and LLM-authored in that its
 * behaviour depends on prose wording. A case author writing "parental distress" instead of "family
 * concern" changes nothing; writing "moderate concern" silently switches the eyes on at 0.55.
 * Natural-language input in the production path is what the dark-factory directive is meant to
 * remove.
 *
 * THE CHEAP FIX THIS REFUSES. Adding "concern" to the keyword list fixes one string and leaves the
 * class — the next literal worded "worried", "guarded" or "avoidant" dies the same way, silently.
 * The RED clause (below) therefore enumerates drive-channel prose from the tree and asserts every
 * one resolves non-null, and the COUNTERWEIGHT asserts a synthetic literal present in no keyword
 * list ("on parental worry from case") also resolves non-null. "Add concern to the list" fails the
 * counterweight; a sane default, or the D9-correct redesign where drive channels carry scalars
 * with prose as a label beside the number, passes it.
 *
 * THE VACUITY GUARD (#361's wrong-reason green, not reproduced). The resolver is imported
 * DYNAMICALLY inside the RED clause, never at module top level: a top-level import of a missing
 * export fails the whole module and the `it.fails` clause then "passes" for the wrong reason. The
 * source scan is a plain `it` sibling asserting at least 3 literals are found, so the enum net is
 * provably live independent of the resolver. The scan skips this test file and the resolver module
 * itself — their headers document the literals and must not self-match.
 *
 * SCOPE (D4). Pure code-path test: no renderer, no booted scene, no GLB read. It asserts that
 * every drive-channel prose string in the tree resolves to a number, nothing about how it looks.
 *
 * NOT TESTED. Whether the dead channel is visible to a learner (no pixel grade; the eyes simply do
 * not avert for that actor — code-path measurement only). Non-literal drive sources: values
 * arriving from generated JSON at runtime were not enumerated. Coverage of the other two channels
 * beyond the three literals found.
 */

/**
 * ## FIXED (#362)
 *
 * `apps/ui-xr/src/generated-drive-scalar.ts` now exports `generatedDriveScalar` (extracted from
 * main.ts:8214-8239, pure move) and the class is bound at two levels:
 *
 *   - the resolver accepts `{ value, label }` scalar objects, so a drive channel carries the
 *     case-authored NUMBER with prose kept as a label beside it (D9: prose is not the number's
 *     source); and
 *   - prose matching no keyword list resolves to the sane default `0.55` instead of `null` — an
 *     unmatched literal degrades, it never silently dies. "Add `concern` to the keyword list"
 *     remains refused: the counterweight synthetic ("on parental worry from case") is in no list.
 *
 * `apps/ui-xr/src/runtime-state.ts` now carries the three shipped literals as scalar objects with
 * their labels (values chosen to reproduce the previously-working resolutions, and the intended
 * moderate level for the dead one):
 *
 *   literal                                  | value (label unchanged)
 *   -----------------------------------------|-----------------------
 *   gazeAversion (peds)                      | 0.85 ("on escalation from case triggers")
 *   gazeAversion (ed, was null)              | 0.55 ("on family concern from case")
 *   lipSyncViseme (peds + ed)                | 0.55 ("medium from hints")
 *
 * The RED below is flipped to a live assertion: every drive-channel prose string in the tree
 * resolves non-null. The vacuity guard is unchanged — the resolver is imported dynamically inside
 * the clause and the source scan is a plain `it` sibling, so a missing export cannot make the
 * clause pass for the wrong reason (#361's trap).
 */

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const SCAN_ROOTS = ["apps/ui-xr/src", "packages/openclinxr"].map((root) => join(REPO_ROOT, root));
const SELF = resolve(fileURLToPath(import.meta.url));
const RESOLVER_MODULE = join(REPO_ROOT, "apps/ui-xr/src/generated-drive-scalar.ts");

const DRIVE_CHANNELS = ["locomotion", "gaze", "gazeAversion", "lipSync", "lipSyncViseme"];
const FIELD_ASSIGNMENT_RE = new RegExp(
  `\\b(${DRIVE_CHANNELS.join("|")})\\s*:\\s*("[^"\\n]*"|\\{[^}]*\\})`,
  "g",
);
const LABEL_RE = /\blabel\s*:\s*"([^"]*)"/;

type DriveProseHit = { literal: string; file: string };

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Every drive-channel prose string in the tree: legacy `channel: "..."` literals and `label: "..."` beside a scalar. */
function enumerateDriveChannelProse(): DriveProseHit[] {
  const hits: DriveProseHit[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkSourceFiles(root)) {
      if (file === SELF || file === RESOLVER_MODULE) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(FIELD_ASSIGNMENT_RE)) {
        const value = match[2] ?? "";
        const literal = value.startsWith('"')
          ? (JSON.parse(value) as string)
          : (LABEL_RE.exec(value)?.[1] ?? null);
        if (literal !== null) {
          hits.push({ literal, file });
        }
      }
    }
  }
  return hits;
}

async function requireResolver(): Promise<(value: unknown) => number | null> {
  const specifier = "./generated-drive-scalar.js";
  const mod = (await import(/* @vite-ignore */ specifier).catch(() => null)) as {
    generatedDriveScalar?: unknown;
  } | null;
  const resolver =
    typeof mod?.generatedDriveScalar === "function"
      ? (mod.generatedDriveScalar as (value: unknown) => number | null)
      : null;
  if (resolver === null) {
    throw new Error("apps/ui-xr/src/generated-drive-scalar.ts must export generatedDriveScalar");
  }
  return resolver;
}

describe("generated drive channels resolve to a scalar, never a silent null (#362)", () => {
  const proseHits = enumerateDriveChannelProse();

  it("(NET) source scan finds at least 3 drive-channel prose strings in the tree", () => {
    const distinct = new Set(proseHits.map((hit) => hit.literal));
    expect(distinct.size, `drive-channel prose found: ${[...distinct].join(" | ")}`).toBeGreaterThanOrEqual(3);
  });

  it(
    "(RED flipped) every drive-channel prose string in the tree resolves to a non-null scalar",
    async () => {
      const resolver = await requireResolver();
      const dead = proseHits.filter((hit) => resolver(hit.literal) === null);
      expect(
        dead,
        `drive-channel prose resolving to null is a silently dead channel: ${dead.map((d) => d.literal).join(" | ")}`,
      ).toEqual([]);
    },
  );

  it("(COUNTERWEIGHT) a synthetic literal present in no keyword list still resolves non-null", async () => {
    const resolver = await requireResolver();

    expect(
      resolver("on parental worry from case"),
      'synthetic literal "on parental worry from case" must degrade to a scalar, not null',
    ).not.toBeNull();
  });
});
