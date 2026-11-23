import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { glbGeometryDigest, glbGeometryDigestExcludingJoints } from "../../../../packages/openclinxr/factory-station-core/src/glb-geometry-digest.js";
import { applyF1, movePositionToSecondBuffer, nudgeAccessor, nudgeNodeField, probe, remapDoc, renameNode, setInterp, shareOutput, structuralDiff } from "./finalize-rig-stage-fixtures.js";

const FINALIZE = "tools/openclinxr/asset-pipeline/makeclothes/finalize_post_export_stage.py";
const TOOL = "tools/openclinxr/asset-pipeline/makeclothes/fixture-rig-stage.ts";
const MAPS = "tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py";
const SHIPPED = "apps/ui-xr/public/generated-humanoids/mpfb-gown-inspect.glb";
const EYES = ["eye.L", "eye.R"];
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const shaFile = (p: string): string => sha(readFileSync(p));
const shipped = (): Buffer => readFileSync(path.join(process.cwd(), SHIPPED));
const runFinalize = (a: string[]) => spawnSync("python3", ["-I", path.join(process.cwd(), FINALIZE), ...a], { encoding: "utf8" });
function stageRegistry(dir: string, tool: string, joints: string[]): string {
  const src = path.join(process.cwd(), "packages/openclinxr/factory-station-core/src");
  for (const f of ["post-export-stage-registry.ts", "glb-geometry-digest.ts", "post-export-stage-mint.ts"]) copyFileSync(path.join(src, f), path.join(dir, f === "post-export-stage-registry.ts" ? "registry.ts" : f));
  const reg = realpathSync(path.join(dir, "registry.ts"));
  const maps = tool === MAPS;
  const entry = `  "${tool}": { mutates: ${maps ? '["materials", "textures", "images"]' : '["rig"]'}, preserves: ${maps ? '["geometry", "rig", "animations", "procedural-gown-lineage", "teeth-swap-evidence"]' : '["geometry", "rig"]'}, rigJoints: [${joints.map((j) => `"${j}"`).join(", ")}] },\n`;
  writeFileSync(reg, readFileSync(reg, "utf8").replace("\n};\n\nconst INTERPRETERS", `\n${entry}};\n\nconst INTERPRETERS`));
  return reg;
}
function runCase(tag: string, joints: string[], pre: Buffer, post: Buffer, pin: "pre" | "post", tools: [string, string, string | null] = [TOOL, TOOL, TOOL]) {
  const [entryTool, sidecarTool, flagTool] = tools;
  const dir = mkdtempSync(path.join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), `finalize-rig-${tag}-`));
  const reg = stageRegistry(dir, entryTool, joints);
  const preP = path.join(dir, `${tag}-pre.glb`); const postP = path.join(dir, `${tag}-post.glb`);
  writeFileSync(preP, pre); writeFileSync(postP, post);
  const sidecar = path.join(dir, `${tag}.provenance.json`);
  const flagArgv = ["mise", "exec", "--", "python3", flagTool ?? entryTool, "--in", preP, "--out", postP, "--provenance", sidecar];
  const sideArgv = ["mise", "exec", "--", "python3", sidecarTool, "--in", preP, "--out", postP, "--provenance", sidecar];
  const pinSha = pin === "pre" ? sha(pre) : sha(post);
  writeFileSync(sidecar, JSON.stringify({ outputSha256: pinSha, outputBytes: (pin === "pre" ? pre : post).byteLength, byteLineage: { derivationArgv: sideArgv, outputSha256: pinSha, preImageSha256: sha(pre) } }));
  const consumers = path.join(dir, `${tag}.consumers.json`);
  writeFileSync(consumers, JSON.stringify({ consumers: [] }));
  const before = { sha: shaFile(sidecar), entries: readdirSync(dir).sort(), doc: readFileSync(sidecar, "utf8") };
  const flag = flagTool === null ? [] : ["--stage-argv-json", JSON.stringify(flagArgv)];
  const r = runFinalize(["--pre", preP, "--post", postP, "--sidecar", sidecar, "--consumers", consumers, "--test-registry", reg, ...flag]);
  return { dir, r, sidecar, before, fields: structuralDiff(pre, post), flagArgv: flag.length ? (JSON.parse(flag[1] as string) as string[]) : null };
}
function expectRefused(c: ReturnType<typeof runCase>, why: RegExp, tag: string): void {
  console.log(`${tag} changed-field set: ${c.fields.join(", ")}`);
  const flog = process.env["FINALIZE_RIG_FIELDSLOG"];
  if (flog !== undefined) appendFileSync(flog, `${tag}: ${c.fields.join(", ")}\n`);
  try {
    expect(c.r.status, `${tag} refuses`).not.toBe(0);
    expect(c.r.stderr, `${tag} reason`).toMatch(why);
    expect(shaFile(c.sidecar), `${tag} sidecar byte-identical`).toBe(c.before.sha);
    expect(readdirSync(c.dir).sort(), `${tag} no new file`).toEqual(c.before.entries);
  } finally { rmSync(c.dir, { recursive: true, force: true }); }
}
const jaw = (f: Buffer) => probe(f, "jaw");
const NEED_SHIPPED = new Set(["F6", "F8", "M10", "H4"]);
const PREMUT: Record<string, (f: Buffer) => Buffer> = { M6: (f) => setInterp(f, "jaw", "LINEAR"), H3: (f) => shareOutput(f, "jaw", "eye.L"), H4: (f) => renameNode(f, "jaw", "eye.L") };
const rows: [string, string[], (f: Buffer) => Buffer, "pre" | "post", RegExp, [string, string, string | null]?][] = [
  ["F2", EYES, (f) => nudgeNodeField(f, "jaw", "translation", 1, 1e-3), "pre", /geometry digest gate failed/],
  ["F3", EYES, (f) => nudgeAccessor(f, jaw(f).body, 0, 1e-3), "pre", /geometry digest gate failed/],
  ["F4", EYES, (f) => nudgeAccessor(f, jaw(f).ibm, jaw(f).slot * 16, 1e-3), "pre", /geometry digest gate failed/],
  ["F5", EYES, (f) => nudgeAccessor(f, jaw(f).out, 0, 1e-3), "pre", /geometry digest gate failed/],
  ["F6", ["eye.L", "eye.M"], (f) => f, "post", /eye\.M/],
  ["F7", EYES, (f) => nudgeNodeField(f, "eye.L", "rotation", 0, 1e-3), "pre", /geometry digest gate failed/],
  ["F8", ["jaw"], (f) => applyF1(f), "post", /geometry digest gate failed/],
  ["H1", EYES, (f) => remapDoc(f, (d) => { const h = d.nodes.findIndex((n) => n.mesh !== undefined); (d.nodes[h] as { translation?: number[] }).translation = [1, 2, 3]; }), "pre", /geometry digest gate failed/],
  ["H2", EYES, (f) => remapDoc(f, (d) => { const e = d.nodes.findIndex((n) => n.name === "eye.L"); const li = d.nodes.length; d.nodes.push({ name: "loc" }); const host = d.nodes[e] as { children?: number[] }; host.children = [...(host.children ?? []), li]; }), "pre", /geometry digest gate failed/],
  ["H3", EYES, (f) => nudgeAccessor(f, probe(f, "eye.L").out, 0, 1e-3), "pre", /excluded accessor .* undeclared use/],
  ["H4", EYES, (f) => nudgeNodeField(f, "eye.L", "translation", 1, 1e-3), "pre", /matches 2 nodes/],
  ["H5", EYES, (f) => movePositionToSecondBuffer(f), "pre", /GLB BIN chunk only/],
  ["M6", EYES, (f) => setInterp(f, "jaw", "STEP"), "pre", /geometry digest gate failed/],
  ["M10", EYES, (f) => applyF1(f), "pre", /not a rig stage/, [MAPS, MAPS, null]],
];
describe("finalize rig stage (FINALIZE-RIG-STAGE)", () => {
  it("F1 eye.L/eye.R translation + IBM + outputs finalize green", { timeout: 180_000 }, () => {
    const pre = shipped(); const post = applyF1(pre);
    const c = runCase("f1", EYES, pre, post, "pre", [TOOL, MAPS, TOOL]);
    const b = JSON.parse(c.before.doc) as { byteLineage: Record<string, unknown> };
    console.log(`F1 changed-field set: ${c.fields.join(", ")}`);
    const log = process.env["FINALIZE_RIG_F1LOG"];
    if (log !== undefined) writeFileSync(log, `${c.fields.join("\n")}\n`);
    try {
      expect(c.r.status, `F1 passes (stderr: ${c.r.stderr})`).toBe(0);
      const a = JSON.parse(readFileSync(c.sidecar, "utf8")) as { outputSha256: string; outputBytes: number; byteLineage: { derivationArgv: unknown; outputSha256: string; preImageSha256: string; stageRecord?: { rigStage?: unknown } } };
      expect(a.outputSha256, "F1 sidecar pins post").toBe(sha(post));
      expect(a.byteLineage.derivationArgv, "F1 appends rig level").toEqual(c.flagArgv);
      expect(a.byteLineage.outputSha256, "F1 lineage pins post").toBe(sha(post));
      expect(a.byteLineage.preImageSha256, "F1 keeps pre-image").toBe(b.byteLineage["preImageSha256"]);
      expect(a.byteLineage.stageRecord?.rigStage, "F1 stage record").toEqual({ tool: TOOL, argv: c.flagArgv, postSha256: sha(post), postBytes: post.byteLength });
      expect([...c.fields].sort(), "F1 only declared fields").toEqual(["accessor 16", "accessor 583", "accessor 597", "node 105 translation", "node 110 translation"]);
    } finally { rmSync(c.dir, { recursive: true, force: true }); }
  });
  it.each(rows)("%s refuses", { timeout: 180_000 }, (tag: string, joints: string[], mut: (f: Buffer) => Buffer, pin: "pre" | "post", why: RegExp, tools?: [string, string, string | null]) => {
    const base = NEED_SHIPPED.has(tag) ? shipped() : applyF1(shipped());
    const pre = (PREMUT[tag] ?? ((f: Buffer) => f))(base);
    expectRefused(runCase(tag.toLowerCase(), joints, pre, mut(pre), pin, tools ?? [TOOL, TOOL, TOOL]), why, tag);
  });
  it("A1 empty exclusion mask is byte-identical to the base digest", { timeout: 180_000 }, () => {
    // Known-good digests for these GLBs are recorded in the card's RESULT-h1 A1 table, not pinned here.
    const names = ["mpfb-ob-patient-aisha.glb", "mpfb-gown-inspect.glb", "mpfb-viseme-inspect.glb", "mpfb-clinical-nurse-adult.glb"];
    for (const name of names) {
      const bytes = new Uint8Array(readFileSync(path.join(process.cwd(), "apps/ui-xr/public/generated-humanoids", name)));
      expect(glbGeometryDigestExcludingJoints(bytes, []), `${name} empty mask == base`).toBe(glbGeometryDigest(bytes));
    }
  });
});
