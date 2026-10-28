import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rebuildEquipmentCatalog } from "./inventory.js";
import { resolveDeferredNonEquipment, resolveProseToEquipmentId } from "./prose-map.js";
import { validateEquipmentCatalog } from "./validate.js";

const TEST_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(TEST_FILE, "..", "..", "..", "..", "..");

const BUILDERS_REL = "packages/openclinxr/xr-station/src/station-equipment-builders.ts";
const CATALOG_REL = "packages/openclinxr/xr-station/src/station-equipment-catalog.ts";
const BARREL_REL = "packages/openclinxr/xr-station/src/station-equipment.ts";

function makeFixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "equipment-source-contract-"));
  for (const rel of [BUILDERS_REL, CATALOG_REL, BARREL_REL]) {
    const src = path.join(REPO_ROOT, rel);
    const dest = path.join(root, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(src, dest, { force: true });
  }
  return root;
}

function writeCanonicalCatalog(fixtureRoot: string, text: string): void {
  writeFileSync(path.join(fixtureRoot, CATALOG_REL), text, "utf8");
}

function bankRowGlb(root: string, equipmentId: string): string | null {
  const doc = rebuildEquipmentCatalog(root);
  return doc.rows.find((r) => r.equipmentId === equipmentId)?.gltfFileName ?? null;
}

describe("equipment source contract (MADR 0054/0055)", () => {
  it("maps all six knee-clinic prose labels (4 aliases + 2 deferred)", () => {
    expect(resolveProseToEquipmentId("clinic chairs")).toBe("chairs_equipment");
    expect(resolveProseToEquipmentId("crutches")).toBe("crutches_equipment");
    expect(resolveProseToEquipmentId("goniometer")).toBe("goniometer_equipment");
    expect(resolveProseToEquipmentId("ice pack")).toBe("ice_pack_equipment");
    expect(resolveDeferredNonEquipment("clipboard rooming notes")?.class).toBe(
      "handheld_cognitive_aid",
    );
    expect(resolveDeferredNonEquipment("elastic knee sleeve")?.class).toBe(
      "patient_worn_support",
    );
  });

  it("proves the 4 alias ids are actual existing builders", () => {
    const root = makeFixtureRoot();
    try {
      const doc = rebuildEquipmentCatalog(root);
      for (const id of [
        "chairs_equipment",
        "crutches_equipment",
        "goniometer_equipment",
        "ice_pack_equipment",
      ] as const) {
        const row = doc.rows.find((r) => r.equipmentId === id);
        expect(row).toBeDefined();
        expect(row?.builderSymbol).not.toBeNull();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads bank GLB mapping from the real canonical source via rebuild", () => {
    const root = makeFixtureRoot();
    try {
      expect(bankRowGlb(root, "bedside_monitor_equipment")).toBe(
        "bedside-monitor-generated.glb",
      );
      expect(bankRowGlb(root, "wall_clock_equipment")).toBe("wall-clock-analog.glb");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("changes the bank row when the canonical catalog entry is mutated", () => {
    const root = makeFixtureRoot();
    try {
      const before = bankRowGlb(root, "bedside_monitor_equipment");
      expect(before).toBe("bedside-monitor-generated.glb");
      const canonical = readFileSync(path.join(root, CATALOG_REL), "utf8");
      writeCanonicalCatalog(
        root,
        canonical.replace("bedside-monitor-generated.glb", "bedside-monitor-renamed.glb"),
      );
      expect(bankRowGlb(root, "bedside_monitor_equipment")).toBe(
        "bedside-monitor-renamed.glb",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("nulls the bank row and fails validation when the entry is removed", () => {
    const root = makeFixtureRoot();
    try {
      const canonical = readFileSync(path.join(root, CATALOG_REL), "utf8");
      writeCanonicalCatalog(
        root,
        canonical.replace(/^\s*bedside_monitor_equipment:.*$/mu, ""),
      );
      const doc = rebuildEquipmentCatalog(root);
      const row = doc.rows.find((r) => r.equipmentId === "bedside_monitor_equipment");
      expect(row?.gltfFileName).toBeNull();
      const result = validateEquipmentCatalog(doc);
      expect(result.ok).toBe(false);
      expect(
        result.errors.some((e) => e.includes("bedside_monitor_equipment") && e.includes("gltfFileName")),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves unknown prose unmapped and defers only known non-equipment", () => {
    expect(resolveProseToEquipmentId("quantum stethoscope")).toBeNull();
    expect(resolveDeferredNonEquipment("quantum stethoscope")).toBeNull();
    expect(resolveProseToEquipmentId("soft lighting")).toBeNull();
  });
});
