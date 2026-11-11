import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { validateSiteData } from "./site-data-schemas.js";

const schemaNames = ["claims", "media", "grades", "roadmap"] as const;

function makeSiteRoot(
  extraData: Record<string, unknown> = {},
  omitSchemas: string[] = [],
): string {
  const root = mkdtempSync(path.join(tmpdir(), "wv0-schemas-"));
  const dataDir = path.join(root, "docs", "site", "data");
  mkdirSync(dataDir, { recursive: true });
  const realDir = path.join(process.cwd(), "docs", "site", "data");
  for (const name of schemaNames) {
    if (omitSchemas.includes(name)) {
      continue;
    }
    cpSync(path.join(realDir, `${name}.schema.json`), path.join(dataDir, `${name}.schema.json`));
  }
  for (const [file, value] of Object.entries(extraData)) {
    writeFileSync(path.join(dataDir, file), JSON.stringify(value));
  }
  return root;
}

function validClaim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // Shape of claims-seed v3 CL1, with the empty state WC1 seeds.
  return {
    id: "CL1",
    text: 'Each learner sees "Station N of M" from the server.',
    shas: ["e223e9759", "d275f1a53"],
    state: "",
    probe: {
      kind: "test",
      path: "packages/openclinxr/xr-sync-client/src/a-synced-learner-is-told-which-station-they-are-in.test.ts",
    },
    slots: [{ slot: "K2", demonstrates: "learner pane shows 'Station 1 of 3' from the server" }],
    ...overrides,
  };
}

function validClaimsFile(claims: unknown[]): Record<string, unknown> {
  return {
    schemaVersion: "openclinxr.site-claims-seed.v3",
    segments: [{ id: "M1", text: "OpenClinXR gives clinical educators an", claims: [] }],
    composites: { mission: ["M1"] },
    claims,
  };
}

it("known-good: temp dir with the 4 schemas and no data files gives []", async () => {
  const root = makeSiteRoot();
  expect(await validateSiteData(root)).toEqual([]);
});

it("known-good: temp dir with a minimal valid claims.json gives []", async () => {
  const root = makeSiteRoot({ "claims.json": validClaimsFile([validClaim()]) });
  const blockers = await validateSiteData(root);
  if (JSON.stringify(blockers) !== "[]") {
    throw new Error(`expected [], got ${JSON.stringify(blockers)}`);
  }
});

it("negative: a claims.json whose claim lacks id gives exactly one claims blocker", async () => {
  const { id: _dropped, ...claimWithoutId } = validClaim();
  const root = makeSiteRoot({ "claims.json": validClaimsFile([claimWithoutId]) });
  const blockers = await validateSiteData(root);
  if (blockers.length !== 1) {
    throw new Error(`expected exactly 1 blocker, got ${JSON.stringify(blockers)}`);
  }
  if (!blockers[0]?.startsWith("site_data_schema_invalid:claims")) {
    throw new Error(`expected claims blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("negative: a media.json slot with state SHOWN gives a media blocker", async () => {
  const media = {
    slots: [
      {
        id: "K1",
        kind: "visual",
        state: "SHOWN",
        ceilingBytes: 2500000,
        audio: false,
        voice: "none",
        releaseTag: null,
      },
    ],
  };
  const root = makeSiteRoot({ "media.json": media });
  const blockers = await validateSiteData(root);
  if (!blockers.some((blocker) => blocker.startsWith("site_data_schema_invalid:media"))) {
    throw new Error(`expected media blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("negative: a grades.json entry whose sha256 is abc gives a grades blocker", async () => {
  const grades = {
    entries: [
      {
        path: "store/site-reimagine/k1/clip.mp4",
        sha256: "abc",
        grader: "super-ceo",
        graderSession: "cap13",
        gradeMessageId: "msg_001",
        demonstrates: "click-to-play clip",
      },
    ],
  };
  const root = makeSiteRoot({ "grades.json": grades });
  const blockers = await validateSiteData(root);
  if (!blockers.some((blocker) => blocker.startsWith("site_data_schema_invalid:grades"))) {
    throw new Error(`expected grades blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("negative: a missing schema gives site_data_schema_missing", async () => {
  const root = makeSiteRoot({}, ["claims"]);
  const blockers = await validateSiteData(root);
  if (!blockers.includes("site_data_schema_missing:claims")) {
    throw new Error(`expected missing-schema blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("counterweight: on fixtures/wv0 the validator's blocker ids equal those recorded from 963d78e13 before the change", () => {
  const fixtureDir = path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "fixtures", "wv0");
  const before = JSON.parse(readFileSync(path.join(fixtureDir, "blockers-before.json"), "utf8")) as {
    blockerIds: string[];
  };
  const root = makeSiteRoot();
  mkdirSync(path.join(root, "docs", "openclinxr"), { recursive: true });
  cpSync(path.join(fixtureDir, "docs", "index.html"), path.join(root, "docs", "index.html"));
  const run = spawnSync(
    path.join(process.cwd(), "node_modules", ".bin", "tsx"),
    [path.join(process.cwd(), "tools", "openclinxr", "evidence", "check-github-pages-site.ts")],
    { cwd: root, encoding: "utf8" },
  );
  const after = run.stderr.split("\n").filter((line) => /^[a-z_]+(:|$)/.test(line));
  expect(run.status).toBe(1);
  for (const id of before.blockerIds) {
    expect(after).toContain(id);
  }
});
