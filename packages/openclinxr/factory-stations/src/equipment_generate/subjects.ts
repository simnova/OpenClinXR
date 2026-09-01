import { existsSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../repo-root.js";

const STANDARD_VIEW_NAMES = [
  "front.png",
  "side.png",
  "three_quarter_left.png",
  "three_quarter_right.png",
] as const;

export type EquipmentSubjectEntry = {
  subjectId: string;
  displayName: string;
  viewRels: string[];
};

export { repoRoot };

function packViewRels(folder: string): string[] {
  return STANDARD_VIEW_NAMES.map((name) => `${folder}/${name}`);
}

export function resolvePackPath(rel: string, root = repoRoot()): string {
  const env = process.env["OPENCLINXR_TRELLIS_PACKS"];
  if (env) return path.join(env, rel);

  const tracked = path.join(root, "tools/openclinxr/asset-pipeline/trellis/packs", rel);
  if (existsSync(tracked)) return tracked;

  const local = path.join(root, ".openclinxr/evidence/issue-232", rel);
  if (existsSync(local)) return local;

  return path.join(root, "tools/openclinxr/asset-pipeline/trellis/packs", rel);
}

export function resolveExistingViewPaths(entry: EquipmentSubjectEntry, root = repoRoot()): string[] {
  return entry.viewRels.map((rel) => resolvePackPath(rel, root)).filter((p) => existsSync(p));
}

export const KNOWN_EQUIPMENT_SUBJECTS: readonly EquipmentSubjectEntry[] = [
  { subjectId: "wall-clock", displayName: "wall clinical / exam-room analog clock", viewRels: packViewRels("wall-clock") },
  { subjectId: "bedside-monitor", displayName: "multi-parameter bedside monitor", viewRels: packViewRels("bedside-monitor") },
  { subjectId: "ecg-cart", displayName: "12-lead ECG cart", viewRels: packViewRels("ecg-cart") },
  {
    subjectId: "ecg-cart-imagine-box",
    displayName: "12-lead ECG cart Imagine-box hard-surface 4-view (not PACK_A #232)",
    viewRels: packViewRels("ecg-cart-imagine-box"),
  },
  { subjectId: "ecg-cart-midband", displayName: "12-lead ECG cart midband kit (Stab E)", viewRels: packViewRels("ecg-cart-midband") },
  {
    subjectId: "ecg-cart-midband-6view",
    displayName: "12-lead ECG cart midband kit 6-view (cardinal+oblique)",
    viewRels: [
      "ecg-cart-midband-6view/top.png",
      "ecg-cart-midband-6view/left.png",
      "ecg-cart-midband-6view/right.png",
      "ecg-cart-midband-6view/bottom.png",
      "ecg-cart-midband-6view/three_quarter_top_left_front.png",
      "ecg-cart-midband-6view/three_quarter_bottom_right_back.png",
    ],
  },
  {
    subjectId: "ecg-cart-midband-2tq",
    displayName: "12-lead ECG cart midband kit 2× three-quarter (fidelity)",
    viewRels: ["ecg-cart-midband-2tq/three_quarter_left.png", "ecg-cart-midband-2tq/three_quarter_right.png"],
  },
  {
    subjectId: "ecg-cart-midband-2oblique",
    displayName: "12-lead ECG cart midband kit high-TLF + low-BRB (fidelity)",
    viewRels: [
      "ecg-cart-midband-2oblique/three_quarter_top_left_front.png",
      "ecg-cart-midband-2oblique/three_quarter_bottom_right_back.png",
    ],
  },
  { subjectId: "iv-pole", displayName: "IV pole equipment", viewRels: packViewRels("iv_pole_equipment") },
  { subjectId: "o2-port", displayName: "wall oxygen port equipment", viewRels: packViewRels("oxygen_wall_port_equipment") },
  { subjectId: "iv-pole-escape", displayName: "IV pole (escape-hatch) — single upper-¾ ALPHA view", viewRels: ["iv-pole-escape/three_quarter_upper_alpha.png"] },
  {
    subjectId: "bedside-monitor-escape",
    displayName: "Bedside monitor (escape-hatch) — single upper-¾ ALPHA view",
    viewRels: ["bedside-monitor-escape/three_quarter_upper_alpha.png"],
  },
  { subjectId: "wall-clock-escape", displayName: "Wall clock (escape-hatch) — single upper-¾ ALPHA view", viewRels: ["wall-clock-escape/three_quarter_upper_alpha.png"] },
  { subjectId: "o2-port-escape", displayName: "O2 port (escape-hatch) — single upper-¾ ALPHA view", viewRels: ["o2-port-escape/three_quarter_upper_alpha.png"] },
  { subjectId: "iv-pump-escape", displayName: "IV pump (escape-hatch) — single upper-¾ ALPHA view", viewRels: ["iv-pump-escape/three_quarter_upper_alpha.png"] },
  {
    subjectId: "fetal-monitor-escape",
    displayName: "Fetal monitor (escape-hatch) — single upper-¾ ALPHA view",
    viewRels: ["fetal-monitor-escape/three_quarter_upper_alpha.png"],
  },
];

export function findEquipmentSubject(subjectId: string): EquipmentSubjectEntry | undefined {
  return KNOWN_EQUIPMENT_SUBJECTS.find((row) => row.subjectId === subjectId);
}
