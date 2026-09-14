import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: docs/openclinxr/humanoid-motion-ENTRYPOINT.md current instruction
 * still presents “nothing is built” and “run a bake-off first” as live orders
 * (one-line state + “Do this, in this order”) while
 * tools/openclinxr/evidence/motion-backend-bakeoff/report.json already records a
 * landed bake-off with verdict `other` (inconclusive; no backend winner).
 *
 * claimScope: whether CURRENT instruction sections (not historical quotes) match
 *   live report.json verdict + live actor/report digest classification, and
 *   whether decision-ledger.json is structurally complete and a distinct reviewer acceptance attestation binds final output bytes. Identity labels are owner cross-checked on the live board; this test is not authentication or proof of review quality.
 * notEvidenceFor: visual quality, clutch anatomy, clinical validity, Quest,
 *   M1 backend fitness, or any global architecture winner.
 *
 * Diagnosis IMMUTABLE. Flip `it.fails` -> `it` and append ## FIXED. Do not
 * rewrite this header’s measured paths. Do not edit report.json hashes to
 * pretend capture is current.
 *
 * live: is valid here (raw it.fails, not motion-compiler planted()).
 *
 * ## FIXED (MR-01 / tsk_7177631409c3d441)
 * (2) Current one-line cites landed bake-off verdict `other` and no longer presents
 *     “nothing is built” as live instruction. Historical stale one-line is a blockquote.
 * (3) Current execution order cites the reassessment ledger, live report verdict `other`,
 *     and the required registry-precedence sentence. It no longer says run the bake-off
 *     first as if it had not landed. Historical bake-off-first order is a blockquote.
 * (7) LEFT PLANTED. Owner acceptance gate; worker must not self-certify.
 */

const REPO = join(import.meta.dirname, "../../../..");
const ENTRYPOINT = join(REPO, "docs/openclinxr/humanoid-motion-ENTRYPOINT.md");
const LEDGER_JSON = join(
  REPO,
  "docs/openclinxr/humanoid-motion-reassessment-2026-09-13/decision-ledger.json",
);
const LEDGER_MD = join(
  REPO,
  "docs/openclinxr/humanoid-motion-reassessment-2026-09-13/decision-ledger.md",
);
const PROPOSAL = join(
  REPO,
  "docs/openclinxr/humanoid-motion-reassessment-2026-09-13/comparison-proposal.md",
);
const MANIFEST = join(
  REPO,
  "docs/openclinxr/humanoid-motion-reassessment-2026-09-13/delegation-manifest.json",
);
const REPORT = join(REPO, "tools/openclinxr/evidence/motion-backend-bakeoff/report.json");
const ACTOR = join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const CONTROL = join(import.meta.dirname, "fixtures/stale-current-instruction-control.md");

const TOPIC_IDS = [
  "ik-blend-vs-target-distance",
  "expression-vs-cooperation",
  "schema-validation",
  "pass-order-bone-ownership",
  "seated-rest-transfer",
  "rig-capability-identity",
  "catalog-transitions",
  "package-station-boundary",
  "evidence-vs-obsolete-failures",
  "physics-touch-fence",
  "provider-eligibility",
  "open-decision-posture-field",
  "open-decision-station-topology",
  "open-decision-package-adapter",
  "open-decision-rock-frame",
  "open-decision-cooperation-join",
  "open-decision-ik-blend",
  "open-decision-station-schema",
  "open-decision-tolerance-authority",
  "open-decision-cooperation-provenance",
] as const;

const CLASSES = new Set(["math", "engineering", "policy", "authoring", "observed"]);
const STATUSES = new Set(["retained", "reopened", "unknown", "superseded"]);

const sha256File = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const read = (path: string): string => readFileSync(path, "utf8");

const section = (md: string, heading: string): string => {
  const re = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const start = md.search(re);
  if (start < 0) return "";
  const rest = md.slice(start);
  const next = rest.slice(1).search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

/** Current instruction = section minus blockquotes, strike, and HTML comments. */
const currentProse = (sectionMd: string): string =>
  sectionMd
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/~~[\s\S]*?~~/g, "")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");

const STALE_ONE_LINE = /nothing is built/i;
const STALE_BAKEOFF_ORDER = /run the bake-off|run a bake-off first/i;

const isStaleCurrentInstruction = (oneLineProse: string, doThisProse: string): boolean =>
  STALE_ONE_LINE.test(oneLineProse) || STALE_BAKEOFF_ORDER.test(doThisProse);

type Report = { verdict?: string; actorAssetSha256?: string; measuredAgainstCommit?: string };

const report = (): Report => JSON.parse(read(REPORT)) as Report;

type Caller = { kind: "production" | "none"; path?: string; evidence: string };
type Topic = {
  id: string;
  claim: string;
  class: string;
  status: string;
  currentSource: { path: string; sha256: string };
  caller: Caller;
  claimScope: string;
  notEvidenceFor: string;
  ownerDecision: string;
  phaseReleaseOwnerGate: string;
};
type Ledger = {
  schemaVersion?: string;
  inputIdentity?: {
    actorPath?: string;
    reportActorSha256?: string;
    diskActorSha256?: string;
    classification?: string;
  };
  phaseRelease?: { mr01?: string; mr02?: string; mr03?: string };
  topics?: Topic[];
};

const ledger = (): Ledger => JSON.parse(read(LEDGER_JSON)) as Ledger;

describe("the entrypoint current state matches landed evidence", () => {
  it("(0) VACUITY: entrypoint, report, actor, retained control, and seed ledger/proposal/manifest exist", () => {
    for (const [path, label] of [
      [ENTRYPOINT, "ENTRYPOINT"],
      [REPORT, "bake-off report.json"],
      [ACTOR, "actor GLB"],
      [CONTROL, "stale-instruction control fixture"],
      [LEDGER_JSON, "decision-ledger.json"],
      [LEDGER_MD, "decision-ledger.md"],
      [PROPOSAL, "comparison-proposal.md"],
      [MANIFEST, "delegation-manifest.json"],
    ] as const) {
      expect(existsSync(path), `${label} missing at ${path} — not an import RED`).toBe(true);
    }
    const r = report();
    expect(r.verdict, "report.json has no verdict; landed/inconclusive cannot be cited").toEqual(
      expect.any(String),
    );
    expect(String(r.verdict).length, "empty verdict").toBeGreaterThan(0);
    expect(r.actorAssetSha256, "report records no actorAssetSha256").toMatch(/^[0-9a-f]{64}$/u);
  });

  it("(1) RETAINED CONTROL: the fixture is still unsupported current instruction (all files present)", () => {
    const control = read(CONTROL);
    const oneLine = currentProse(section(control, "The one-line state"));
    const doThis = currentProse(section(control, "Do this, in this order"));
    expect(oneLine.length, "control lost its one-line section").toBeGreaterThan(20);
    expect(doThis.length, "control lost its do-this section").toBeGreaterThan(20);
    expect(
      isStaleCurrentInstruction(oneLine, doThis),
      "control was weakened so the detector no longer fires — restore the genuine stale current-instruction fixture",
    ).toBe(true);
  });

  it("(2) RED: ENTRYPOINT current one-line is not the unsupported “nothing is built” instruction", () => {
    const md = read(ENTRYPOINT);
    const oneLine = currentProse(section(md, "The one-line state"));
    expect(oneLine.length, "ENTRYPOINT missing ## The one-line state").toBeGreaterThan(20);
    expect(
      STALE_ONE_LINE.test(oneLine),
      "current one-line still presents “nothing is built” as live instruction (historical blockquotes/strike are allowed)",
    ).toBe(false);
  });

  it("(3) RED: ENTRYPOINT current order is not “run the bake-off first”; it cites live report verdict and the ledger", () => {
    const md = read(ENTRYPOINT);
    const doThis = currentProse(section(md, "Do this, in this order"));
    const oneLine = currentProse(section(md, "The one-line state"));
    const current = `${oneLine}\n${doThis}`;
    const r = report();
    expect(doThis.length, "ENTRYPOINT missing ## Do this, in this order").toBeGreaterThan(20);
    expect(
      STALE_BAKEOFF_ORDER.test(doThis),
      "current execution order still says run the bake-off first as if it had not landed",
    ).toBe(false);
    expect(
      current.includes(String(r.verdict)),
      `current instruction must cite the live report.json verdict (${r.verdict}), not a hardcoded winner`,
    ).toBe(true);
    expect(current).toContain(
      'The doc-authority-registry-2026-05-27.json takes precedence over this ENTRYPOINT’s “Read this first” and historical “AUTHORITATIVE” wording.',
    );
    expect(
      current.includes("humanoid-motion-reassessment-2026-09-13/decision-ledger"),
      "current instruction must reference the review ledger path",
    ).toBe(true);
  });

  it("(4) ledger JSON has required topics, classes, live source paths, and owner gates", () => {
    const doc = ledger();
    expect(doc.schemaVersion).toBe("openclinxr.humanoid-motion-decision-ledger.v1");
    expect(doc.phaseRelease?.mr02, "MR-02 must remain owner-gated").toMatch(/owner|blocked/i);
    expect(doc.phaseRelease?.mr03, "MR-03 must remain owner-gated").toMatch(/owner|blocked/i);
    const topics = doc.topics ?? [];
    const ids = topics.map((t) => t.id);
    expect(new Set(ids).size, "duplicate topic IDs").toBe(ids.length);
    for (const id of TOPIC_IDS) expect(ids, `missing required topic ${id}`).toContain(id);
    for (const t of topics) {
      expect(t.claim.trim().length, `${t.id} empty claim`).toBeGreaterThan(8);
      expect(CLASSES.has(t.class), `${t.id} class ${t.class}`).toBe(true);
      expect(STATUSES.has(t.status), `${t.id} status ${t.status}`).toBe(true);
      expect(t.claimScope.trim().length, `${t.id} claimScope`).toBeGreaterThan(8);
      expect(t.notEvidenceFor.trim().length, `${t.id} notEvidenceFor`).toBeGreaterThan(8);
      expect(t.ownerDecision.trim().length, `${t.id} ownerDecision`).toBeGreaterThan(8);
      expect(t.phaseReleaseOwnerGate.trim().length, `${t.id} phaseReleaseOwnerGate`).toBeGreaterThan(3);
      const src = join(REPO, t.currentSource.path);
      expect(existsSync(src), `${t.id} currentSource missing ${t.currentSource.path}`).toBe(true);
      expect(t.currentSource.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(t.currentSource.sha256, `${t.id} source hash stale vs ${t.currentSource.path}`).toBe(
        sha256File(src),
      );
      expect(["production", "none"]).toContain(t.caller.kind);
      expect(t.caller.evidence.trim().length, `${t.id} caller evidence`).toBeGreaterThan(8);
      if (t.caller.kind === "production") {
        expect(t.caller.path, `${t.id} production caller needs path`).toMatch(/\S/);
        expect(existsSync(join(REPO, String(t.caller.path))), `${t.id} caller path missing`).toBe(
          true,
        );
      }
    }
  });

  it("(5) input-identity classification follows live actor vs report hashes (not a frozen dd074568 stale bit)", () => {
    const r = report();
    const disk = sha256File(ACTOR);
    const recorded = String(r.actorAssetSha256);
    const computed = disk === recorded ? "current-actor-bound" : "identity-stale";
    const listed = ledger().inputIdentity;
    expect(listed?.actorPath).toBe("apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
    expect(listed?.reportActorSha256).toBe(recorded);
    expect(listed?.diskActorSha256).toBe(disk);
    expect(
      listed?.classification,
      `classification must equal live compare (report ${recorded.slice(0, 8)} disk ${disk.slice(0, 8)})`,
    ).toBe(computed);

  });

  it("(6) comparison proposal does not declare a backend winner", () => {
    const text = read(PROPOSAL);
    expect(text).toMatch(/rock-plus-clutch|rock_plus_clutch/);
    expect(text).toMatch(/pulse/i);
    expect(text).toMatch(/owner/i);
    expect(text, "proposal must not crown a backend").not.toMatch(
      /\b(baked_tracks|runtime_goals)\s+wins\b/i,
    );
  });

  it.fails("(7) OWNER ACCEPTANCE: independent review is accepted and binds final output identities", () => {
    const manifest = JSON.parse(read(MANIFEST)) as {
      worker?: { sessionId?: string };
      independentSemanticReview?: {
        status?: string;
        reviewerName?: string;
        reviewerSessionId?: string;
        reviewRecord?: string;
        reviewedAt?: string;
        outputSha256?: Record<string, string>;
      };
    };
    const review = manifest.independentSemanticReview;
    const nativeSessionId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,199}$/u;
    expect(manifest.worker?.sessionId, "owner cross-checks actual worker session against board").toMatch(nativeSessionId);
    expect(review?.status, "owner records accepted review after worker returns review").toBe("accepted");
    expect(review?.reviewerName?.trim().length, "named independent reviewer").toBeGreaterThan(2);
    expect(review?.reviewerSessionId, "reviewer session identity").toMatch(nativeSessionId);
    expect(review?.reviewerSessionId, "reviewer must differ from actual worker").not.toBe(manifest.worker?.sessionId);
    expect(review?.reviewRecord?.trim().length, "owner links claim-by-claim review record").toBeGreaterThan(8);
    expect(Number.isFinite(Date.parse(String(review?.reviewedAt))), "review timestamp").toBe(true);
    for (const path of [ENTRYPOINT, LEDGER_JSON, LEDGER_MD, PROPOSAL]) {
      const rel = path.slice(REPO.length + 1);
      expect(review?.outputSha256?.[rel], `accepted review output binding stale/missing for ${rel}`).toBe(sha256File(path));
    }
  });

});
