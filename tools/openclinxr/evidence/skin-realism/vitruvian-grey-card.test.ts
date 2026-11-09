import { readFileSync } from "node:fs";
import { Matrix4 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCaptureSpec,
  parseCli,
  patientYawFromSceneDump,
  runGreyCardHookIfEnabled,
} from "./vitruvian-compare.js";
import {
  gitBlobSha,
  greyCardFullyOffFrame,
  isHudSafeNdc,
  pngFrameSize,
  resolveCaptureCardOutcome,
  resolveCardCropBox,
  patientRootFrameMatrix,
  sortLightsStable,
  worldFromPatientRootFrame,
} from "./vitruvian-grey-card.js";

const BASE = [
  "--actor", "mpfb-ob-patient-aisha",
  "--new", "apps/ui-xr/public/generated-humanoids",
  "--out", ".openclinxr/evidence/grey-card-test",
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vitruvian grey-card capture option", () => {
  it("threads --grey-card into the harness hook without touching the lab spec", async () => {
    const cli = parseCli([...BASE, "--grey-card"]);
    const spec = buildCaptureSpec({
      actor: cli.actors[0]!,
      variant: "new",
      lightingSpec: { productEnvironmentId: "ob_triage_room_v1" },
      framing: "forearm-close",
      captureSize: 4096,
      greyCard: cli.greyCard,
    });
    expect(cli.greyCard).toBe(true);
    expect(Object.hasOwn(spec, "greyCard")).toBe(false);
    expect(await runGreyCardHookIfEnabled(cli.greyCard, async () => "card-ran")).toBe("card-ran");
  });

  it("runs no card code with the flag off", async () => {
    const cli = parseCli(BASE);
    const spec = buildCaptureSpec({
      actor: cli.actors[0]!,
      variant: "new",
      lightingSpec: { productEnvironmentId: "ob_triage_room_v1" },
      framing: "forearm-close",
      captureSize: 4096,
      greyCard: cli.greyCard,
    });
    expect(cli.greyCard).toBe(false);
    expect(cli.greyCardPlacement).toBeUndefined();
    expect(cli.greyCardPosition).toBeUndefined();
    expect(cli.lightToggle).toBe(false);
    expect(Object.hasOwn(spec, "greyCard")).toBe(false);
    let calls = 0;
    expect(await runGreyCardHookIfEnabled(cli.greyCard, async () => { calls += 1; return "unexpected"; })).toBeNull();
    expect(calls).toBe(0);
  });

  it("parses app-root placement and light toggles only when explicitly enabled", () => {
    const cli = parseCli([
      ...BASE,
      "--grey-card",
      "--grey-card-placement", "app-room-grey-card.json",
      "--grey-card-position", "neck",
      "--grey-card-camera", "card",
      "--light-toggle",
      "--scenario-id", "ed_chest_pain_priority_v1",
      "--product-environment-id", "ed_exam_bay_v1",
    ]);
    expect(cli).toMatchObject({
      greyCard: true,
      greyCardPlacement: "app-room-grey-card.json",
      greyCardPosition: "neck",
      greyCardCamera: "card",
      lightToggle: true,
      scenarioId: "ed_chest_pain_priority_v1",
      productEnvironmentId: "ed_exam_bay_v1",
    });
  });

  it("requires app grey-card placement before accepting measured patient yaw", () => {
    expect(() => parseCli([...BASE, "--grey-card", "--patient-yaw-from", "scene-dump.json"]))
      .toThrow("--patient-yaw-from requires --grey-card-placement");
  });

  it.each([0, 2])("refuses a scene dump with %i primary_patient roots", (count) => {
    const tagged = Array.from({ length: count }, () => ({
      slotKind: "primary_patient",
      matrixWorld: new Matrix4().toArray(),
    }));
    expect(() => patientYawFromSceneDump({ tagged }, "scene-dump.json"))
      .toThrow(`scene-dump.json has ${count} primary_patient roots; expected exactly 1`);
  });

  it("reads peds measured yaw from the primary-patient matrix", () => {
    const matrixWorld = [
      0.87401, 0, -0.10247, 0,
      0, 0.88, 0, 0,
      0.10247, 0, 0.87401, 0,
      -0.9, 0, 0.08, 1,
    ];
    const measured = patientYawFromSceneDump({
      tagged: [{ slotKind: "primary_patient", matrixWorld }],
    }, "peds/scene-dump.json");
    expect(measured.source).toBe("peds/scene-dump.json");
    expect(measured.yawRadians * 180 / Math.PI).toBeCloseTo(6.687, 2);
  });

  it("round trips a card transform through the patient-root frame", () => {
    const patientRoot = [
      0, 2, 0, 0,
      -3, 0, 0, 0,
      0, 0, 4, 0,
      5, -7, 11, 1,
    ];
    const cardWorld = [
      0.5, 0, 0, 0,
      0, 0, 0.5, 0,
      0, -1, 0, 0,
      1.25, 2.5, -3.75, 1,
    ];
    const roundTrip = worldFromPatientRootFrame(patientRoot, patientRootFrameMatrix(patientRoot, cardWorld));
    roundTrip.forEach((value, index) => {
      expect(value).toBeCloseTo(cardWorld[index]!, 9);
    });
  });

  it("rejects the HUD bands while accepting an interior point", () => {
    expect(isHudSafeNdc({ x: 0, y: 0.85, z: 0 })).toBe(false);
    expect(isHudSafeNdc({ x: 0, y: 0.75, z: 0 })).toBe(true);
  });

  it("sorts same-role lights deterministically by type then world position", () => {
    const fixture = [
      { id: "b", role: "fill", type: "PointLight", worldPosition: [2, 0, 0] },
      { id: "a", role: "fill", type: "DirectionalLight", worldPosition: [9, 0, 0] },
      { id: "c", role: "fill", type: "PointLight", worldPosition: [-1, 0, 0] },
    ];
    expect(sortLightsStable(fixture).map(({ id }) => id)).toEqual(["a", "c", "b"]);
    expect(sortLightsStable(fixture).map(({ id }) => id)).toEqual(["a", "c", "b"]);
  });
});

describe("product rig patient staging anchor", () => {
  it("keeps authored patient heading after the lab framing callback", () => {
    const source = readFileSync(
      new URL("../../../../packages/openclinxr/xr-station-room/src/runtime-actor-placement.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /input\.applyActorFraming\(patient, patientActorId, placement\);[\s\S]*consumeAuthoredHeading\(patient, placement, patientActorId\);/u,
    );
  });

  it("binds the product lab to the admitted staging exports and primary-patient slot", () => {
    const source = readFileSync(
      new URL("../../../../apps/ui-xr/isolated-subject.html", import.meta.url),
      "utf8",
    );
    expect(source).toContain('from "@openclinxr/xr-station-room"');
    expect(source).toContain("resolveRuntimeActorPlacement({");
    expect(source).toContain("applyStagedPatientRootTransform({");
    expect(source).toContain("fallback: defaultPatientActorPlacement");
    expect(source).toContain("resolveRuntimeSlotAssignment(bundle).patientActorId");
    expect(source).toMatch(/\/xr-assets\/generated\/\$\{scenarioId\}\/learner-runtime-bundle\.v1\.json/u);
  });

  it("removes the legacy castThree translation before a product-rig capture is rendered", () => {
    const source = readFileSync(
      new URL("../../../../packages/openclinxr/xr-scene/src/isolated-subject-product-rig.ts", import.meta.url),
      "utf8",
    );
    expect(
      source,
      "Restore the shared staged-patient anchor; restoring castThree reintroduces the measured 16 L* fill gap.",
    ).toMatch(/light\.position\.sub\(input\.legacyTranslation\)\.applyMatrix4\(anchor\)/u);
    expect(
      source,
      "Restore the shared staged-patient anchor; restoring castThree reintroduces the measured 16 L* fill gap.",
    ).toMatch(/legacyCastAnchorRemoved: true/u);
  });
});

describe("grey card off frame on a region pass", () => {
  const FRAME = { width: 4096, height: 4096 };
  // Measured forearm region pass, i2 warm_light-forearm-close (card behind/beside the camera).
  const FOREARM_BOX = { x0: 9909, y0: 0, x1: 4096, y1: -1143 };
  const PARTLY_VISIBLE = { x0: 3900, y0: 3800, x1: 4400, y1: 4300 };

  it("records a fully off-frame card on a region pass without measuring it", () => {
    expect(greyCardFullyOffFrame(FOREARM_BOX, FRAME)).toBe(true);
    expect(resolveCaptureCardOutcome(FOREARM_BOX, FRAME, false)).toBe("off_frame");
    expect(resolveCardCropBox(null, true)).toEqual({ box: { x0: 0, y0: 0, x1: 0, y1: 0 }, offFrame: true });
  });

  it("measures a partly visible card and throws when the crop then excludes it", () => {
    expect(greyCardFullyOffFrame(PARTLY_VISIBLE, FRAME)).toBe(false);
    expect(resolveCaptureCardOutcome(PARTLY_VISIBLE, FRAME, false)).toBe("measure");
    expect(() => resolveCardCropBox(null, false)).toThrow("grey card was requested but the output crop excluded it");
  });

  it("clips x by width and y by height on a non-square frame", () => {
    const wide = { width: 4096, height: 1024 };
    expect(greyCardFullyOffFrame({ x0: 100, y0: 2000, x1: 300, y1: 2200 }, wide)).toBe(true);
    expect(greyCardFullyOffFrame({ x0: 3000, y0: 100, x1: 3200, y1: 300 }, wide)).toBe(false);
  });

  it("reads the frame size from the PNG header", () => {
    const header = new Uint8Array(24);
    header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(header.buffer).setUint32(16, 2101);
    new DataView(header.buffer).setUint32(20, 1500);
    expect(pngFrameSize(header)).toEqual({ width: 2101, height: 1500 });
    expect(() => pngFrameSize(new Uint8Array(10))).toThrow("not a PNG");
  });

  it("refuses an empty card box on a card-camera pass", () => {
    expect(() => resolveCaptureCardOutcome(FOREARM_BOX, FRAME, true)).toThrow("card-camera pass framed an empty card box");
  });

  it("records the tool blob sha git prints for the same bytes", () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(gitBlobSha(new TextEncoder().encode("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});
