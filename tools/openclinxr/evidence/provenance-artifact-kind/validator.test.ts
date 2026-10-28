import { describe, expect, it } from "vitest";
import {
  claimsBakedFields,
  DECLARATION_ONLY_SCHEMA,
  isDeclarationOnly,
  validateDeclarationOnly,
} from "../provenance-artifact-kind.js";

const inspectionBody = (): Record<string, unknown> => ({
  schemaVersion: DECLARATION_ONLY_SCHEMA,
  declarationOnly: true,
  asset: "mpfb-gown-inspect.glb",
  runtimeRole: "inspection_fixture",
});

describe("provenance artifact-kind units (same helper as clause 2)", () => {
  it("true inspection passes: typed, non-cast, no baked claims, unreached", () => {
    const b = inspectionBody();
    expect(isDeclarationOnly(b)).toBe(true);
    expect(claimsBakedFields(b)).toBe(false);
    expect(validateDeclarationOnly("x.provenance.json", b, new Set())).toEqual([]);
  });

  it("production-bound declaration rejects: live cast containing the asset fails the ban", () => {
    const b = inspectionBody();
    const live = new Set(["apps/ui-xr/public/generated-humanoids/mpfb-gown-inspect.glb"]);
    expect(validateDeclarationOnly("mpfb-gown-inspect.provenance.json", b, live)).not.toEqual([]);
  });

  it("unknown/untyped rejects: never counts as declaration-only, stays under the bake convention", () => {
    expect(isDeclarationOnly({})).toBe(false);
    expect(isDeclarationOnly({ schemaVersion: DECLARATION_ONLY_SCHEMA })).toBe(false);
    expect(isDeclarationOnly({ declarationOnly: true })).toBe(false);
    expect(isDeclarationOnly({ schemaVersion: "openclinxr.generated-humanoid-provenance.v1" })).toBe(false);
  });

  it("baked missing derivation rejects: untyped-or-baked body without derivationMode fails", () => {
    const bakedNoDeriv: Record<string, unknown> = {
      schemaVersion: "openclinxr.generated-humanoid-provenance.v1",
    };
    expect(isDeclarationOnly(bakedNoDeriv)).toBe(false);
    expect(typeof bakedNoDeriv["derivationMode"]).not.toBe("string");
    const badDecl: Record<string, unknown> = { ...inspectionBody(), derivationMode: "orchestrate" };
    expect(claimsBakedFields(badDecl)).toBe(true);
    expect(validateDeclarationOnly("y.provenance.json", badDecl, new Set())).not.toEqual([]);
  });
});
