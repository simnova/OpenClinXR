import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export type BaseSubject =
  | { kind: "comparable"; baseObj: string; baseObjSource: "provenance-ref" | "basename-fallback"; provenancePath: string }
  | { kind: "excluded-noncomparable"; reason: string; evidence: { provenancePath: string; sourceKind: string; derivationMode: string } }
  | { kind: "excluded-fixture"; reason: string; evidence: { provenancePath: string; schemaVersion: string; runtimeRole: string } }
  | { kind: "error"; reason: string; attempted: string[] };

export type ExcludedSubject = { assetPath: string; reason: string; evidence: Record<string, string> };
export type FixtureProof = {
  isDeclarationOnlyFixture: (body: Record<string, unknown>) => boolean;
  validateFixture: (name: string, body: Record<string, unknown>, live: ReadonlySet<string>) => string[];
  liveAssetPaths: ReadonlySet<string>;
};
/** ONE runtime proof for BOTH rails: actual shipped bytes + actual mesh names (runner-passed, 4th arg). */
export type RuntimeProof = { actualGlbSha256: string | null; bodyMeshNames: readonly string[] | null };

const SHA256_HEX = /^[0-9a-f]{64}$/iu;
const TRACKED_MARKER = /\s*\(tracked\)\s*$/u;
const CANON_REL_DIR = "apps/ui-xr/public/generated-humanoids";
const CANON_SUFFIX = ".anny_base.obj";

function provenancePathFor(g: string): string { return g.replace(/\.glb$/i, ".provenance.json"); }
function readBody(p: string): Record<string, unknown> | null {
  let raw: string;
  try { raw = readFileSync(p, "utf8"); } catch { return null; }
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

/** Confine a provenance annyReference to the canonical GEN dir BEFORE any file read. Returns abs path or error. */
export function confineAnnyReference(ref: string, repoRoot: string): { abs: string } | { error: string } {
  const target = ref.replace(TRACKED_MARKER, "").trim();
  if (path.isAbsolute(target)) return { error: `absolute annyReference rejected ${JSON.stringify(ref)}` };
  if (/(^|[/\\])\.\.(?=$|[/\\])/.test(target)) return { error: `traversal annyReference rejected ${JSON.stringify(ref)}` };
  if (/\.bak|\.backup|~$/i.test(target)) return { error: `backup annyReference rejected ${JSON.stringify(ref)}` };
  const canonDir = path.join(repoRoot, CANON_REL_DIR);
  const abs = path.resolve(canonDir, target.startsWith(CANON_REL_DIR + "/") ? target.slice(CANON_REL_DIR.length + 1) : target);
  let canonReal: string; try { canonReal = realpathSync(canonDir); } catch { canonReal = canonDir; }
  let absReal: string;
  try { absReal = realpathSync(abs); } catch { absReal = abs; }
  if (absReal !== canonReal && !absReal.startsWith(canonReal + path.sep)) return { error: `escaping annyReference rejected ${JSON.stringify(ref)}` };
  if (!absReal.endsWith(CANON_SUFFIX)) return { error: `non-canonical annyReference rejected ${JSON.stringify(ref)}` };
  return { abs: absReal };
}

export function resolveBaseSubject(glbPath: string, repoRoot: string, fixtureProof?: FixtureProof, proof?: RuntimeProof): BaseSubject {
  const attempted: string[] = [];
  const provPath = provenancePathFor(glbPath);
  const rel = (p: string): string => path.relative(repoRoot, p).replace(/\\/g, "/");
  const glbFile = path.basename(glbPath);
  if (!existsSync(provPath)) { attempted.push(provPath); return { kind: "error", reason: `absent sibling provenance ${rel(provPath)}`, attempted }; }
  const body = readBody(provPath);
  if (body === null) { attempted.push(provPath); return { kind: "error", reason: `sibling provenance ${rel(provPath)} unreadable`, attempted }; }
  if (fixtureProof !== undefined && fixtureProof.isDeclarationOnlyFixture(body)) {
    const problems = fixtureProof.validateFixture(glbFile, body, fixtureProof.liveAssetPaths);
    if (problems.length > 0) return { kind: "error", reason: `declaration-only fails shared validation: ${problems.join("; ")}`, attempted: [provPath] };
    const sv = typeof body["schemaVersion"] === "string" ? body["schemaVersion"] : "";
    const rr = typeof body["runtimeRole"] === "string" ? body["runtimeRole"] : "";
    return { kind: "excluded-fixture", reason: `declaration-only fixture runtimeRole ${JSON.stringify(rr)}`, evidence: { provenancePath: rel(provPath), schemaVersion: sv, runtimeRole: rr } };
  }
  const sourceKind = body["sourceKind"];
  const derivationMode = body["derivationMode"];
  const deriv = typeof derivationMode === "string" ? derivationMode : String(derivationMode);
  const annyReference = (body["sourceOriginChain"] as { annyReference?: unknown } | undefined)?.annyReference;
  const names = proof?.bodyMeshNames ?? null;
  const sha = proof?.actualGlbSha256 ?? null;
  const hasAnnyBody = names !== null && names.some((n) => /anny_base/i.test(n));
  const hasMpfbBody = names !== null && names.some((n) => /mpfb_.*_body/i.test(n));
  if (typeof sourceKind === "string" && /^mpfb2_/i.test(sourceKind)) {
    const outputSha = typeof body["outputSha256"] === "string" ? body["outputSha256"] : null;
    if (hasAnnyBody) return { kind: "error", reason: `MPFB kind ${JSON.stringify(sourceKind)} but shipped GLB carries anny_base body`, attempted: [provPath] };
    const bound = sha !== null && outputSha !== null && SHA256_HEX.test(outputSha) && SHA256_HEX.test(sha) && outputSha.toLowerCase() === sha.toLowerCase();
    if (!bound || names === null || !hasMpfbBody) return { kind: "error", reason: `MPFB kind ${JSON.stringify(sourceKind)} exclusion unproven`, attempted: [provPath] };
    return { kind: "excluded-noncomparable", reason: `MPFB-rail output (sourceKind ${JSON.stringify(sourceKind)}), digest-bound`, evidence: { provenancePath: rel(provPath), sourceKind, derivationMode: deriv } };
  }
  const isKnownAnny = typeof sourceKind === "string" && /^real_anny_/i.test(sourceKind);
  if (typeof annyReference === "string" && annyReference.length > 0) {
    if (!isKnownAnny) return { kind: "error", reason: `unknown kind ${JSON.stringify(sourceKind ?? null)} with annyReference cannot prove Anny`, attempted: [provPath] };
    const confined = confineAnnyReference(annyReference, repoRoot);
    if ("error" in confined) return { kind: "error", reason: confined.error, attempted: [provPath] };
    attempted.push(confined.abs);
    if (existsSync(confined.abs)) {
      if (names === null || !hasAnnyBody) return { kind: "error", reason: `known-Anny without actual anny_base body proof`, attempted };
      return { kind: "comparable", baseObj: confined.abs, baseObjSource: "provenance-ref", provenancePath: provPath };
    }
    return { kind: "error", reason: `known-Anny base missing`, attempted };
  }
  if (isKnownAnny) {
    const fallback = glbPath.replace(/\.glb$/i, ".anny_base.obj");
    const confined = confineAnnyReference(path.basename(fallback), repoRoot);
    if ("error" in confined) return { kind: "error", reason: confined.error, attempted: [provPath] };
    attempted.push(confined.abs);
    if (existsSync(confined.abs)) {
      if (names === null || !hasAnnyBody) return { kind: "error", reason: `known-Anny without actual anny_base body proof`, attempted };
      return { kind: "comparable", baseObj: confined.abs, baseObjSource: "basename-fallback", provenancePath: provPath };
    }
    return { kind: "error", reason: `known-Anny base missing`, attempted };
  }
  attempted.push(provPath);
  return { kind: "error", reason: `sourceKind ${JSON.stringify(sourceKind ?? null)} untraceable, cannot prove non-Anny`, attempted };
}

export function parseObjMesh(objPath: string): {
  vertCount: number;
  faceCount: number;
  triangles: number;
  connectedComponents: number;
} {
  const text = readFileSync(objPath, "utf8");
  let vertCount = 0;
  const faces: number[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      vertCount += 1;
    } else if (line.startsWith("f ")) {
      const idxs = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((tok: string) => {
          const vi = Number.parseInt(tok.split("/")[0] ?? "", 10);
          return vi < 0 ? vertCount + vi : vi - 1;
        });
      faces.push(idxs);
    }
  }
  let triangles = 0;
  for (const f of faces) triangles += Math.max(0, f.length - 2);
  return {
    vertCount,
    faceCount: faces.length,
    triangles,
    connectedComponents: countConnectedComponents(vertCount, faces),
  };
}

export function countConnectedComponents(vertCount: number, faces: number[][]): number {
  const adj: number[][] = Array.from({ length: vertCount }, () => []);
  const used = new Uint8Array(vertCount);
  for (const f of faces) {
    for (let i = 0; i < f.length; i += 1) {
      const a = f[i]!;
      const b = f[(i + 1) % f.length]!;
      if (a < 0 || b < 0 || a >= vertCount || b >= vertCount) continue;
      adj[a]!.push(b);
      adj[b]!.push(a);
      used[a] = 1;
      used[b] = 1;
    }
  }
  const seen = new Uint8Array(vertCount);
  let components = 0;
  for (let i = 0; i < vertCount; i += 1) {
    if (!used[i] || seen[i]) continue;
    components += 1;
    const stack = [i];
    seen[i] = 1;
    while (stack.length > 0) {
      const u = stack.pop()!;
      for (const v of adj[u] ?? []) {
        if (!seen[v]) {
          seen[v] = 1;
          stack.push(v);
        }
      }
    }
  }
  return components;
}
