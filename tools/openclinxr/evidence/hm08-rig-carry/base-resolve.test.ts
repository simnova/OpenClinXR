import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type RuntimeProof, resolveBaseSubject } from "../hm08-rig-carry-base-resolve.js";

const dirs: string[] = [];
afterEach(() => { while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true }); });
const SHA_A = "a".repeat(64); const SHA_B = "b".repeat(64);
const GEN = "apps/ui-xr/public/generated-humanoids";
function setup(body: Record<string, unknown>, opts?: { noProv?: boolean; badJson?: boolean; base?: string }): { root: string; glb: string } {
  const root = mkdtempSync(path.join(tmpdir(), "hm08-single-")); dirs.push(root);
  mkdirSync(path.join(root, GEN), { recursive: true });
  const glb = path.join(root, GEN, "x.glb"); writeFileSync(glb, "glb");
  writeFileSync(glb.replace(/\.glb$/i, ".provenance.json"), opts?.badJson ? "{oops" : JSON.stringify(body));
  if (opts?.base) writeFileSync(path.join(root, GEN, opts.base), "v 0 0 0\n");
  return { root, glb };
}
const proof = (sha: string | null, names: readonly string[] | null): RuntimeProof => ({ actualGlbSha256: sha, bodyMeshNames: names });

describe("hm08 single runtime proof", () => {
  it("known Anny ref present is comparable with actual body proof", () => {
    const { root, glb } = setup({ sourceKind: "real_anny_bake", derivationMode: "x", sourceOriginChain: { annyReference: "x.anny_base.obj" } }, { base: "x.anny_base.obj" });
    const s = resolveBaseSubject(glb, root, undefined, proof(SHA_A, ["x_anny_base"]));
    expect(s.kind).toBe("comparable");
    if (s.kind === "comparable") { expect(s.baseObjSource).toBe("provenance-ref"); expect(s.provenancePath).toContain(".provenance.json"); }
  });
  it("known Anny missing proof errors (no bypass)", () => {
    const { root, glb } = setup({ sourceKind: "real_anny_bake", derivationMode: "x", sourceOriginChain: { annyReference: "x.anny_base.obj" } }, { base: "x.anny_base.obj" });
    expect(resolveBaseSubject(glb, root).kind).toBe("error");
  });
  it("known Anny null meshes errors", () => {
    const { root, glb } = setup({ sourceKind: "real_anny_bake", derivationMode: "x", sourceOriginChain: { annyReference: "x.anny_base.obj" } }, { base: "x.anny_base.obj" });
    expect(resolveBaseSubject(glb, root, undefined, proof(SHA_A, null)).kind).toBe("error");
  });
  it("known Anny wrong body (mpfb) errors", () => {
    const { root, glb } = setup({ sourceKind: "real_anny_bake", derivationMode: "x", sourceOriginChain: { annyReference: "x.anny_base.obj" } }, { base: "x.anny_base.obj" });
    expect(resolveBaseSubject(glb, root, undefined, proof(SHA_A, ["mpfb_a_body"])).kind).toBe("error");
  });
  it("known Anny missing base errors", () => {
    const { root, glb } = setup({ sourceKind: "real_anny_bake", derivationMode: "x", sourceOriginChain: { annyReference: "m.anny_base.obj" } });
    expect(resolveBaseSubject(glb, root, undefined, proof(SHA_A, ["m_anny_base"])).kind).toBe("error");
  });
  it("unknown kind with reference errors", () => {
    const { root, glb } = setup({ sourceKind: "weird", derivationMode: "x", sourceOriginChain: { annyReference: "x.anny_base.obj" } }, { base: "x.anny_base.obj" });
    expect(resolveBaseSubject(glb, root, undefined, proof(SHA_A, ["x_anny_base"])).kind).toBe("error");
  });
  it("absolute reference rejected before read", () => {
    const { root, glb } = setup({ sourceKind: "real_anny_bake", derivationMode: "x", sourceOriginChain: { annyReference: "/etc/x.anny_base.obj" } });
    expect(resolveBaseSubject(glb, root, undefined, proof(SHA_A, ["x_anny_base"])).kind).toBe("error");
  });
  it("traversal reference rejected", () => {
    const { root, glb } = setup({ sourceKind: "real_anny_bake", derivationMode: "x", sourceOriginChain: { annyReference: "../evil.anny_base.obj" } });
    expect(resolveBaseSubject(glb, root, undefined, proof(SHA_A, ["x_anny_base"])).kind).toBe("error");
  });
  it("escaping symlink rejected", () => {
    const { root, glb } = setup({ sourceKind: "real_anny_bake", derivationMode: "x", sourceOriginChain: { annyReference: "link.anny_base.obj" } });
    symlinkSync("/etc/hosts", path.join(root, GEN, "link.anny_base.obj"));
    expect(resolveBaseSubject(glb, root, undefined, proof(SHA_A, ["link_anny_base"])).kind).toBe("error");
  });
  it("malformed short SHA errors", () => {
    const { root, glb } = setup({ sourceKind: "mpfb2_makehuman_basemesh", derivationMode: "x", outputSha256: "ABC" });
    expect(resolveBaseSubject(glb, root, undefined, proof("abc", ["mpfb_a_body"])).kind).toBe("error");
  });
  it("forged MPFB (Anny body) errors", () => {
    const { root, glb } = setup({ sourceKind: "mpfb2_makehuman_basemesh", derivationMode: "x", outputSha256: SHA_A });
    expect(resolveBaseSubject(glb, root, undefined, proof(SHA_A, ["x.anny_base"])).kind).toBe("error");
  });
  it("bound MPFB excludes", () => {
    const { root, glb } = setup({ sourceKind: "mpfb2_makehuman_basemesh", derivationMode: "x", outputSha256: SHA_A });
    expect(resolveBaseSubject(glb, root, undefined, proof(SHA_A, ["mpfb_a_body"])).kind).toBe("excluded-noncomparable");
  });
  it("mismatched SHAs error", () => {
    const { root, glb } = setup({ sourceKind: "mpfb2_makehuman_basemesh", derivationMode: "x", outputSha256: SHA_A });
    expect(resolveBaseSubject(glb, root, undefined, proof(SHA_B, ["mpfb_a_body"])).kind).toBe("error");
  });
});
