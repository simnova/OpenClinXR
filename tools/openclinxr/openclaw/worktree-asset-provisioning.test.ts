import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#66) — a worktree carries tracked files only, so every asset slice begins by
 * rebuilding its own inputs by hand.
 *
 * BOTH `it.fails` FLIP. This header is THE RECORD, not scratch — flip them, append a
 * `## FIXED (#66)` block below, and leave the measured numbers intact.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE COST, MEASURED, NOT ESTIMATED
 *
 * #81 ran 95 turns, the largest slice this pipeline has run. Its own breakdown on being asked where
 * the turns went:
 *
 *     product (contracts, posture types, chair, clip binding, placement bugs)   ~45
 *     THRASH (freeze ceilings, missing cagematch/physics copies in the worktree,
 *             re-capturing the room after every placement fix)                  ~40
 *     verify / commit                                                           ~10
 *
 *     "Not 1.5x of a clean 60-turn slice — maybe ~40-50 of product work, ~30-40 thrash."
 *
 * #64 reported the same thing at 47 turns. `prepareWorktreeForWorker` (`dispatch-worker.ts:501-560`)
 * runs `pnpm install` and a workspace build and provisions NOTHING ELSE. A worker sent to regenerate
 * humanoids arrives with no `apps/ui-xr/public/cagematch/` (`.gitignore:24`) and no production OBJs
 * or manifests under `.openclinxr/`.
 *
 * THIS CORRUPTS THE INSTRUMENT, which is the real reason it is worth a slot. The standing direction
 * is to escalate slice size until a worker demonstrably cannot cope, and one of the four criteria is
 * "the environment was not the blocker". Right now it always is, partly — so the turn counts being
 * used to judge whether a worker is near its ceiling are substantially measuring provisioning.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE DESIGN IS DECIDED — three options were attacked in a peer round, here is what survived
 *
 *   SYMLINK the ignored roots back to main:   REJECTED. The dispatch `--deny 'Write(<main>/**)'` is a
 *     literal-path string matcher, not a filesystem sandbox — a computed path walks straight through
 *     it. Symlinking makes main's ignored assets a live write target for three concurrent workers.
 *     Do not do this even though it is the cheapest.
 *
 *   COPY WHOLE ROOTS:  REJECTED ON COST. `apps/ui-xr/public/cagematch/` is 352 MB and
 *     `generated-humanoids/` is 48 MB; at three concurrent workers that is ~1.2 GB per cycle.
 *
 *   COPY DECLARED FILES:  ADOPTED. The brief names the specific paths a slice needs and only those
 *     are provisioned. Where source and destination share a volume, a hardlink or copy-on-write clone
 *     is preferable to a byte copy — that is an implementation choice, but a HARDLINK MAKES THE
 *     WORKER'S WRITES VISIBLE IN MAIN, so if you hardlink you must copy-on-write before any
 *     modification, or fall back to a plain copy. Say which you chose and why.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE FIRST DRAFT OF THIS PROOF WAS VACUOUS AND THE PEER ROUND KILLED IT. It asserted the provisioned
 * path EXISTS. An empty directory satisfies that, and so does a zero-byte file. Content or nothing:
 * the provisioned file must hash equal to main's copy.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE TWO PULL APART. The first is satisfiable by copying everything always, which re-earns the
 * 1.2 GB the peer round rejected — so the second requires an UNDECLARED heavy root to stay absent.
 * A provisioner that ignores its declaration list and copies the world fails the second; one that
 * declares but does not copy fails the first.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `provisionWorktreeAssets({ worktreePath,
 * assetPaths })`. Change the call sites and say why if a different shape is better. What must not
 * change: the declaration comes from the BRIEF, provisioned content is verified by hash rather than
 * presence, and undeclared roots are not copied.
 *
 * REQUIRED, NOT OPTIONAL: wire this into `prepareWorktreeForWorker` so a real dispatch uses it. Three
 * slices in this repo have landed correct and inert because a brief said wiring was optional. A
 * provisioner nothing calls is documentation.
 *
 * NOT DETERMINED, and possibly all wrong — I have not distinguished between these:
 *   - whether `.openclinxr/` manifests matter as much as the GLBs, or are cheaply regenerated
 *   - whether `pnpm test` in a fresh worktree is red for reasons beyond missing ignored paths
 *   - whether the freeze-ceiling thrash #81 reported is the same root cause or a separate item
 * Find out; record what you find even if it contradicts this issue.
 *
 * SCOPE: provisioning ignored inputs into a worker's tree. Says nothing about the other direction —
 * #64's outputs were themselves gitignored and the merge did not carry them, which is the same root
 * cause on the far side of the loop and is deliberately NOT in this slice.
 *
 * ## FIXED (#66)
 *
 * - `provisionWorktreeAssets` / `provisionWorktreeAssetsSync` copy only declared repo-relative
 *   paths from `repoRoot` (main) into `worktreePath`. Content verified by hash in contracts.
 * - Copy strategy: `COPYFILE_FICLONE` (CoW/clonefile when available) else plain copy. No symlink,
 *   no hardlink (worker writes must not appear in main).
 * - Wired: `prepareWorktreeForWorker` calls provision when `assetPaths` set; `dispatch` merges
 *   trusted brief `assetPaths` ∪ `DispatchOptions.assetPaths`; `board-brief` extracts
 *   `## asset_paths` bullets into `BriefResult.assetPaths` for trusted brief writers.
 * - Findings (NOT DETERMINED items measured in this worktree):
 *   - `generated-humanoids/*.glb` are TRACKED (git ls-files); cagematch is gitignored. Manifests
 *     beside GLBs (`.anny_manifest.json`, `.bundle.json`, provenance) are also tracked and small
 *     (4–28 KB). Local `.openclinxr/` is gitignored except README — evidence/manifests there are
 *     checkout-local and cheap to regenerate vs multi-MB GLBs; declare them only when a slice
 *     cannot rebuild them.
 *   - `pnpm test` red on a bare worktree is NOT only missing ignored paths: #54 already proved
 *     missing workspace `dist/` (build-emitting packages) fails 17 files; install+packages:build
 *     is the primary red cause. Missing cagematch is a separate thrash class for asset slices.
 *   - Freeze-ceiling thrash (#81) is a SEPARATE root cause from missing ignored assets: SIZE_FREEZE
 *     lives in architecture-rules and fires when a file grows past budget; provisioning does not
 *     raise ceilings. Same thrash bucket in turn counts, different fix (split file vs provision).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const load = async () =>
  import("./worktree-asset-provisioning.js") as Promise<Record<string, unknown>>;

type Provision = (input: {
  worktreePath: string;
  assetPaths: string[];
  repoRoot?: string;
}) => Promise<{ provisioned: { path: string; bytes: number }[] }>;

const REPO = "/Volumes/files/src/openclinxr";

/** A tracked, stable, small file is a poor test of an IGNORED-path provisioner, so use a real one. */
const DECLARED = "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb";
/** Heavy and deliberately NOT declared — 352 MB of cagematch lanes. */
const UNDECLARED_ROOT = "apps/ui-xr/public/cagematch";

const sha256 = (path: string) =>
  execFileSync("shasum", ["-a", "256", path], { encoding: "utf8" }).split(/\s+/)[0] ?? "";

describe("a worker's tree arrives with the inputs its slice declared (#66)", () => {
  it("a declared asset is provisioned with content identical to main", async () => {
    // Hash, not existence. The first draft of this contract asserted the path existed and would have
    // passed on an empty directory — the peer round caught it, and that is exactly the class of
    // vacuous proof this repo has already paid for six times.
    const mod = await load();
    const provision = mod["provisionWorktreeAssets"] as Provision | undefined;
    expect(provision).toBeTypeOf("function");

    const fakeWorktree = mkdtempSync(join(tmpdir(), "openclinxr-66-"));
    const report = await provision!({ worktreePath: fakeWorktree, assetPaths: [DECLARED], repoRoot: REPO });

    const landed = join(fakeWorktree, DECLARED);
    expect(existsSync(landed), `${DECLARED} was not provisioned at all`).toBe(true);
    expect(sha256(landed), "provisioned file does not match main's bytes").toBe(sha256(join(REPO, DECLARED)));
    expect(report.provisioned.find((p) => p.path === DECLARED)?.bytes, "report claims zero bytes").toBeGreaterThan(0);
  }, 300_000);

  it("an undeclared heavy root is not copied", async () => {
    // Kills "copy everything always", which satisfies the first contract and re-earns the ~1.2 GB
    // per cycle the peer round rejected. Declaration has to mean something.
    const mod = await load();
    const provision = mod["provisionWorktreeAssets"] as Provision | undefined;
    expect(provision).toBeTypeOf("function");

    const fakeWorktree = mkdtempSync(join(tmpdir(), "openclinxr-66b-"));
    await provision!({ worktreePath: fakeWorktree, assetPaths: [DECLARED], repoRoot: REPO });

    expect(
      existsSync(join(fakeWorktree, UNDECLARED_ROOT)),
      `${UNDECLARED_ROOT} was copied without being declared — that is the 352 MB the design rejected`,
    ).toBe(false);
  }, 300_000);
});
