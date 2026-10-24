import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { resolveRuntimeSlotAssignment } from "@openclinxr/xr-capture-evidence";
import { ensureAndPublishActorPlacementSsot } from "@openclinxr/xr-runtime-state";

const here = path.dirname(fileURLToPath(import.meta.url));
/** W tree under test — same worktree this file runs from, never Main. */
const mainTsPath = path.resolve(here, "../../../../apps/ui-xr/src/main.ts");

type BundleParam = Parameters<typeof resolveRuntimeSlotAssignment>[0];

/**
 * Synthetic ED-shaped bundle: patient + clinical authored with case-decided fields,
 * family staged but placementless (the telehealth/knee orphan shape from the RED probe).
 * Only the fields the two public helpers read are populated; the cast through the
 * public parameter type keeps the harness honest about which function surface is used.
 */
function edShapedBundle(): BundleParam {
  return {
    scenarioId: "ed_chest_pain_priority_v2",
    actors: [
      { actorId: "patient_robert_hayes_v1", role: "patient" },
      { actorId: "nurse_kevin_lee_v1", role: "nurse" },
      { actorId: "spouse_maria_hayes_v1", role: "spouse" },
    ],
    sceneManifest: {
      actorPlacements: {
        patient_robert_hayes_v1: {
          slotKind: "primary_patient",
          position: { x: -0.72, y: 1.06, z: -0.12 },
          scale: { x: 1.1, y: 1.1, z: 1.1 },
          verticalOffsetMeters: -0.98,
          labelPrefix: "Patient",
          posture: "supine",
          // 0 is a real heading, not absent — the repair must test TYPE, not truthiness.
          headingRadians: 0,
          placementProvenance: "case_authored",
          plantOffsetMeters: { x: 0.02, z: -0.01 },
          supportInstanceId: "stretcher_deck",
        },
        nurse_kevin_lee_v1: {
          slotKind: "clinical_team",
          position: { x: 1.45, y: 0.95, z: 0.55 },
          scale: { x: 1, y: 1, z: 1 },
          verticalOffsetMeters: -0.95,
          labelPrefix: "Team",
          posture: "standing",
          headingRadians: -0.26,
          placementProvenance: "case_authored",
        },
      },
    },
  } as BundleParam;
}

function withFakeWindow<T>(run: (fake: Record<string, unknown>) => T): T {
  const holder = globalThis as unknown as { window?: Record<string, unknown> };
  const had = holder.window;
  const fake: Record<string, unknown> = {};
  holder.window = fake;
  try {
    return run(fake);
  } finally {
    if (had === undefined) delete holder.window;
    else holder.window = had;
  }
}

describe("startup placement publish (ph42)", () => {
  it("the actual helpers declare every staged slot and keep authored fields", () => {
    const bundle = edShapedBundle();
    const slots = resolveRuntimeSlotAssignment(bundle);
    expect(slots.patientActorId).toBe("patient_robert_hayes_v1");
    expect(slots.clinicalTeamActorId).toBe("nurse_kevin_lee_v1");
    expect(slots.familyActorId).toBe("spouse_maria_hayes_v1");

    const published = withFakeWindow((fake) => {
      ensureAndPublishActorPlacementSsot(bundle, slots);
      return fake["__openClinXrActorPlacementSsot"] as {
        declaredActorIds: string[];
        addedActorIds: string[];
        actorPlacements: Record<string, Record<string, unknown>>;
      };
    });

    // Publisher is what the RED probe found null — it must exist and cover staged ids.
    expect(published, "no placement SSOT published").toBeTypeOf("object");
    for (const id of slots.stagedActorIds.filter(Boolean)) {
      expect(published.declaredActorIds).toContain(id);
      expect(published.actorPlacements[id]).toBeTypeOf("object");
    }
    // The placementless family slot is ensured, not dropped.
    expect(published.addedActorIds).toContain("spouse_maria_hayes_v1");

    // Case-decided fields survive byte-identical, including falsy-but-real heading 0.
    const patient = published.actorPlacements["patient_robert_hayes_v1"]!;
    expect(patient["headingRadians"]).toBe(0);
    expect(patient["posture"]).toBe("supine");
    expect(patient["placementProvenance"]).toBe("case_authored");
    expect(patient["plantOffsetMeters"]).toEqual({ x: 0.02, z: -0.01 });
    expect(patient["supportInstanceId"]).toBe("stretcher_deck");
    expect(patient["verticalOffsetMeters"]).toBe(-0.98);
    expect(patient["labelPrefix"]).toBe("Patient");
    const nurse = published.actorPlacements["nurse_kevin_lee_v1"]!;
    expect(nurse["headingRadians"]).toBe(-0.26);
  });

  it("main.ts publishes the real initial bundle at top level before first use", async () => {
    const source = await readFile(mainTsPath, "utf8");
    const file = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);

    const publishCalls: ts.CallExpression[] = [];
    const enclosingFunctionOf = (node: ts.Node): string | undefined => {
      let current = node.parent;
      while (current) {
        if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
        if (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) return "<anonymous>";
        current = current.parent;
      }
      return undefined;
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.getText(file) === "ensureAndPublishActorPlacementSsot") {
        publishCalls.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);

    const topLevel = publishCalls.filter((c) => enclosingFunctionOf(c) === undefined);
    const inLaterPath = publishCalls.filter((c) => enclosingFunctionOf(c) === "useEncounterRuntimeAssetBundle");
    // Old initial path had zero publishes; the fix adds exactly one; the later path is untouched.
    expect(topLevel, "expected one module-scope startup publish").toHaveLength(1);
    expect(inLaterPath, "later generated/API path must keep its single publish").toHaveLength(1);

    // Same helper, same real bundle/slots as the later path — not a mirrored object.
    const call = topLevel[0]!;
    expect(call.arguments[0]?.getText(file)).toBe("encounterRuntimeAssetBundle");
    const slotsArg = call.arguments[1];
    expect(slotsArg && ts.isCallExpression(slotsArg)).toBe(true);
    const slotsCall = slotsArg as ts.CallExpression;
    expect(slotsCall.expression.getText(file)).toBe("resolveRuntimeSlotAssignment");
    expect(slotsCall.arguments[0]?.getText(file)).toBe("encounterRuntimeAssetBundle");

    const lineOf = (node: ts.Node): number =>
      file.getLineAndCharacterOfPosition(node.getStart(file)).line;
    const cacheDecl = ((): ts.Node | undefined => {
      let found: ts.Node | undefined;
      const find = (node: ts.Node): void => {
        if (
          ts.isVariableDeclaration(node) &&
          node.name.getText(file) === "cachedRuntimeSlotAssignment"
        ) {
          found = node;
        }
        ts.forEachChild(node, find);
      };
      find(file);
      return found;
    })();
    expect(cacheDecl, "cache binding must exist before the call (TDZ guard)").toBeDefined();
    // No TDZ: the call runs after the cache binding it primes.
    expect(lineOf(call)).toBeGreaterThan(lineOf(cacheDecl!));

    // Before first consumer: the earliest stageStationActors call stages the scene.
    const firstStage = ((): ts.CallExpression | undefined => {
      let first: ts.CallExpression | undefined;
      const find = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(file) === "stageStationActors" &&
          !first
        ) {
          first = node;
        }
        ts.forEachChild(node, find);
      };
      find(file);
      return first;
    })();
    expect(firstStage, "scene staging call must exist below the startup publish").toBeDefined();
    expect(lineOf(call)).toBeLessThan(lineOf(firstStage!));

    // Existing public import reused — no new API surface introduced for the fix.
    const usesExistingImport = file.statements.some(
      (s) =>
        ts.isImportDeclaration(s) &&
        s.moduleSpecifier.getText(file).includes("@openclinxr/xr-runtime-state") &&
        s.importClause?.namedBindings &&
        ts.isNamedImports(s.importClause.namedBindings) &&
        s.importClause.namedBindings.elements.some((e) => e.name.text === "ensureAndPublishActorPlacementSsot"),
    );
    expect(usesExistingImport).toBe(true);
  });
});
