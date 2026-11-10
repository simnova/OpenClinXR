/**
 * C52c case list: the 4 RED A bodies x {stretcher flat, 30 deg} UNION every shipped supine
 * (body, deck, incline) found by walking the case blueprints (scenario-fixtures sources), then
 * resolving each supine patient's body GLB and stretcher incline through the package dists.
 * The test imports this module and re-derives; it does not read the list back from the json.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { caseKey } from "./c52c-plant-core.mjs";

export const DECK = "patient_stretcher";
/** Mirrors postureForSupportSurface (asset-registry case-actor-placements-mod.ts:28), not exported. */
const SUPINE_SURFACES = new Set(["stretcher", "bed", "exam_table"]);
/** Mirrors isStretcherSlotId (xr-station station-stretcher.ts:332), not exported. */
function isStretcherSlotId(slotId) {
  const id = slotId.toLowerCase();
  return id === "stretcher" || id.includes("stretcher") || id === "patient_bed" || id.endsWith("_bed") || id === "bed";
}

export function redACases(root) {
  const fixture = JSON.parse(readFileSync(join(root, "packages/openclinxr/xr-pose/src/__fixtures__/supine-plant-pose-before.json"), "utf8"));
  const out = [];
  for (const row of fixture.cases) {
    if (row.condition !== "stretcher_flat" && row.condition !== "stretcher_incline_30") continue;
    out.push({ body: row.asset, deck: DECK, inclineDeg: row.inclineDeg, source: "red-a" });
  }
  return out;
}

function blueprintPathFor(root, scenarioId) {
  const dir = join(root, "packages/openclinxr/scenario-fixtures/src");
  const needle = new RegExp(`scenarioId:\\s*"${scenarioId}"`);
  const hits = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && needle.test(readFileSync(join(dir, f), "utf8")));
  if (hits.length !== 1) throw new Error(`scenario ${scenarioId}: expected one blueprint file, found ${JSON.stringify(hits)}`);
  return `packages/openclinxr/scenario-fixtures/src/${hits[0]}`;
}

export async function deriveShippedCases(root) {
  const imp = (rel) => import(pathToFileURL(join(root, rel)).href);
  const { scenarioBank } = await imp("packages/openclinxr/scenario-fixtures/dist/scenario-bank.js");
  const { resolveEnvironmentShellDescriptor } = await imp("packages/openclinxr/asset-registry/dist/index.js");
  const { resolveHumanoidVariantOrCastPath } = await imp("packages/openclinxr/xr-scene/dist/index.js");
  const out = [];
  for (const scenario of scenarioBank) {
    const environmentId = scenario.environment?.environmentId ?? scenario.environmentId ?? "";
    const shell = resolveEnvironmentShellDescriptor(environmentId);
    const slot = shell.descriptor.fixtureSlots.find((s) => isStretcherSlotId(s.slotId));
    for (const actor of scenario.actors) {
      const surface = actor.placement?.supportSurface;
      if (!SUPINE_SURFACES.has(surface)) continue;
      const path = resolveHumanoidVariantOrCastPath({ scenarioId: scenario.scenarioId, actorId: actor.actorId, role: actor.role, fallbackPath: "/xr-assets/humanoids/neutral-generated-human.glb" });
      const body = path.split("/").at(-1);
      out.push({
        scenarioId: scenario.scenarioId, actorId: actor.actorId, supportSurface: surface, environmentId,
        blueprintPath: blueprintPathFor(root, scenario.scenarioId),
        body, deck: slot ? DECK : "none", inclineDeg: slot && typeof slot.inclineDegrees === "number" ? slot.inclineDegrees : 0,
        stretcherSlotId: slot?.slotId ?? null,
      });
    }
  }
  return out;
}

/** Union by (body, deck, incline); each case lists every source that named it. */
export function unionCases(red, shipped) {
  const byKey = new Map();
  for (const c of red) byKey.set(caseKey(c), { body: c.body, deck: c.deck, inclineDeg: c.inclineDeg, source: ["red-a"] });
  for (const s of shipped) {
    const k = caseKey(s);
    const tag = `shipped:${s.scenarioId}/${s.actorId}`;
    const hit = byKey.get(k);
    if (hit) hit.source.push(tag);
    else byKey.set(k, { body: s.body, deck: s.deck, inclineDeg: s.inclineDeg, source: [tag] });
  }
  return [...byKey.values()];
}

/**
 * Hash of every input that can change a plant result: xr-pose / xr-station / asset-registry non-test
 * sources, the shared core, this case list, the RED A fixture and the GLB bytes of the bodies used.
 * A json cannot name the commit that contains it, so the test accepts headSha == HEAD, or the same
 * input hash at HEAD (survives the json commit and a rebase that leaves these inputs alone).
 */
export function inputTreeHash(root, bodies) {
  const listed = execFileSync("git", ["-C", root, "ls-tree", "-r", "HEAD", "--", "packages/openclinxr/xr-pose/src", "packages/openclinxr/xr-station/src", "packages/openclinxr/asset-registry/src", "tools/openclinxr/evidence/xr-sync/c52c-plant-core.mjs", "tools/openclinxr/evidence/xr-sync/c52c-cases.mjs", "apps/ui-xr/public/generated-humanoids"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const wanted = new Set(bodies);
  const lines = listed.split("\n").filter(Boolean).map((l) => {
    const [meta, path] = l.split("\t");
    return { sha: meta.split(" ")[2], path };
  }).filter(({ path }) => {
    if (path.startsWith("apps/ui-xr/public/generated-humanoids/")) return wanted.has(path.split("/").at(-1));
    if (path.endsWith(".test.ts") || path.endsWith("arch-index.json") || path.endsWith(".json") || path.endsWith(".md")) return path.endsWith("supine-plant-pose-before.json");
    return true;
  }).sort((a, b) => (a.path < b.path ? -1 : 1));
  return createHash("sha256").update(lines.map((l) => `${l.sha} ${l.path}`).join("\n")).digest("hex");
}

/** True when the json's case keys equal the expected union exactly (no missing, no extra, no repeats). */
export function caseSetMatches(jsonCases, expected) {
  const have = jsonCases.map(caseKey).sort();
  const want = expected.map(caseKey).sort();
  return have.length === want.length && have.every((k, i) => k === want[i]);
}

/** The json belongs to this tree: its head is HEAD, or every plant input hashes the same as at HEAD. */
export function treeIsCurrent(json, head, currentInputTree) {
  return json.headSha === head || json.inputTreeSha256 === currentInputTree;
}

/** sha256 over every file under dir: sorted relative path, NUL, bytes. */
function dirSha256(dir) {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  const h = createHash("sha256");
  for (const p of files.map((f) => relative(dir, f)).sort()) h.update(`${p}\0`).update(readFileSync(join(dir, p)));
  return h.digest("hex");
}

/** The pnpm-lock.yaml entry {specifier, version} for dep under importer. */
function lockEntry(lock, importer, dep) {
  const start = lock.indexOf(`\n  ${importer}:\n`);
  if (start < 0) throw new Error(`pnpm-lock.yaml has no importer ${importer}`);
  const rest = lock.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}\S/);
  const block = end < 0 ? rest : rest.slice(0, end + 1);
  const key = dep.startsWith("@") ? `'${dep}'` : dep;
  const m = block.match(new RegExp(`\\n {6}${key.replace(/[/@.]/g, "\\$&")}:\\n {8}specifier: (.+)\\n {8}version: (.+)\\n`));
  if (!m) throw new Error(`pnpm-lock.yaml importer ${importer} has no ${dep}`);
  return { specifier: m[1], version: m[2] };
}

/**
 * What the harness bundles (xr-pose, xr-station dists from packages/, three as those packages resolve it)
 * against what apps/ui-xr resolves: lockfile entry, resolved directory, and dist sha256 for each.
 */
export function bundledPackageProvenance(root) {
  const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  const uiXr = join(root, "apps/ui-xr");
  const rows = ["xr-pose", "xr-station"].map((name) => {
    const dep = `@openclinxr/${name}`;
    const harnessDir = realpathSync(join(root, "packages/openclinxr", name));
    const uiXrDir = realpathSync(join(uiXr, "node_modules", dep));
    const harnessDistSha256 = dirSha256(join(harnessDir, "dist"));
    const uiXrDistSha256 = dirSha256(join(uiXrDir, "dist"));
    return {
      name: dep, lockfile: lockEntry(lock, "apps/ui-xr", dep),
      harnessDir: relative(root, harnessDir), uiXrDir: relative(root, uiXrDir),
      harnessDistSha256, uiXrDistSha256, matchesUiXr: harnessDir === uiXrDir && harnessDistSha256 === uiXrDistSha256,
    };
  });
  const harnessThree = ["xr-pose", "xr-station"].map((n) => realpathSync(join(root, "packages/openclinxr", n, "node_modules/three")));
  const uiXrThree = realpathSync(join(uiXr, "node_modules/three"));
  const threeVersion = JSON.parse(readFileSync(join(uiXrThree, "package.json"), "utf8")).version;
  rows.push({
    name: "three", lockfile: lockEntry(lock, "apps/ui-xr", "three"), version: threeVersion,
    harnessDir: relative(root, harnessThree[0]), uiXrDir: relative(root, uiXrThree),
    matchesUiXr: harnessThree.every((d) => d === uiXrThree),
  });
  return rows;
}
