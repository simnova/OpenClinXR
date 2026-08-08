/**
 * #232 — Grok-image multi-view reference sheets for clinical equipment
 * (TRELLIS prop-lane inputs / factory_step: equipment_generate).
 *
 * Produces and inspects on-disk multi-view image packs + a manifest under
 * `.openclinxr/evidence/issue-232/`. Does NOT run TRELLIS, ComfyUI, Metal
 * stacks, humanoid texturing, or Infinigen.
 *
 * Packs are authored with harness `image_gen` (Grok Imagine) from a
 * worktree-bound session (image_gen reachability proven in #78 clothing
 * cagematch). Views: front | three_quarter_left | three_quarter_right | side.
 *
 * claimScope: multi-view 2D reference packs + manifest for later TRELLIS
 *            consumption; factory input material only.
 * notEvidenceFor: clinical device accuracy; TRELLIS generation success;
 *                 Quest readiness; production equipment adoption; exam
 *                 equivalence; parametric-builder replacement.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

export const ISSUE_ID = "issue-232";
export const EVIDENCE_REL = `.openclinxr/evidence/${ISSUE_ID}`;
export const EVIDENCE_DIR = path.join(REPO_ROOT, EVIDENCE_REL);
export const MANIFEST_REL = `${EVIDENCE_REL}/manifest.json`;
export const MANIFEST_PATH = path.join(REPO_ROOT, MANIFEST_REL);

/** Canonical view labels for TRELLIS multi-view inputs. */
export const REQUIRED_VIEWS = [
  "front",
  "three_quarter_left",
  "three_quarter_right",
  "side",
] as const;

export type ViewLabel = (typeof REQUIRED_VIEWS)[number];

export const DEFAULT_SUBJECTS = [
  {
    subjectId: "ecg-cart",
    displayName: "12-lead ECG cart / monitor cart",
    dirName: "ecg-cart",
  },
  {
    subjectId: "wall-clock",
    displayName: "wall clinical / exam-room analog clock",
    dirName: "wall-clock",
  },
  {
    subjectId: "bedside-monitor",
    displayName: "multi-parameter bedside monitor",
    dirName: "bedside-monitor",
  },
] as const;

export type SubjectSpec = (typeof DEFAULT_SUBJECTS)[number];

export type ViewEntry = {
  view: ViewLabel | string;
  path: string;
  bytes: number;
  prompt: string;
  seed: number | null;
  sourceSessionImage?: string;
};

export type PackEntry = {
  subjectId: string;
  displayName: string;
  dir: string;
  views: ViewEntry[];
  contactSheetPath: string | null;
};

export type EquipmentGrokMultiviewManifest = {
  schemaVersion: "openclinxr.equipment-grok-multiview-sheets.v1";
  issue: "232";
  factoryStep: "equipment_generate";
  generatedAt: string;
  generator: {
    tool: "image_gen";
    harness: "grok";
    note: string;
  };
  claimScope: string[];
  notEvidenceFor: string[];
  subjects: PackEntry[];
};

/** Contract report shape (planted test). */
export type EquipmentGrokMultiviewReport = {
  subjects: string[];
  manifestPath: string;
  packs: Array<{ subjectId: string; views: string[]; minBytes: number }>;
  claimScope: string[];
  notEvidenceFor: string[];
  packsDetail?: PackEntry[];
};

export const CLAIM_SCOPE = [
  "grok_imagine_multiview_2d_reference_packs_for_clinical_equipment",
  "manifest_recording_paths_prompts_and_view_labels",
  "factory_step_equipment_generate_input_material_only",
] as const;

export const NOT_EVIDENCE_FOR = [
  "clinical device accuracy or FDA/device-equivalence claims",
  "TRELLIS generation success or mesh quality",
  "Quest readiness or WebXR frame budget",
  "production equipment adoption into the learner runtime",
  "exam equivalence or clinical validity",
  "replacement of parametric three.js equipment builders",
] as const;

/** Shared style constraints applied to every Grok Imagine prompt. */
export const PROMPT_CONSTRAINTS =
  "Neutral seamless light gray studio background, soft even lighting, " +
  "no logos, no brand text, no readable manufacturer marks, no patient faces, " +
  "no people, clean medical equipment product-catalog style.";

const PROMPTS: Record<string, Record<string, string>> = {
  "ecg-cart": {
    front:
      "Photoreal orthographic product photography of a clinical 12-lead ECG cart / cardiac monitor cart on wheels. Front view. White medical cart with caster wheels, monitor with blank dark screen (no logos/text), ECG cable leads. " +
      PROMPT_CONSTRAINTS,
    three_quarter_left:
      "Photoreal product photography of a clinical 12-lead ECG cart on wheels. Three-quarter left view (~45° front-left). White cart, blank monitor screen, ECG leads, drawers. " +
      PROMPT_CONSTRAINTS,
    three_quarter_right:
      "Photoreal product photography of a clinical 12-lead ECG cart on wheels. Three-quarter right view (~45° front-right). White cart, blank monitor screen, ECG leads, drawers. " +
      PROMPT_CONSTRAINTS,
    side:
      "Photoreal product photography of a clinical 12-lead ECG cart on wheels. True side profile view. White cart silhouette, blank monitor, drawers, caster wheels. " +
      PROMPT_CONSTRAINTS,
  },
  "wall-clock": {
    front:
      "Photoreal orthographic product photography of a wall-mounted clinical exam-room analog clock. Front view. Round white face, black hour marks, black hands, no brand logo. " +
      PROMPT_CONSTRAINTS,
    three_quarter_left:
      "Photoreal product photography of a wall-mounted clinical exam-room analog clock. Three-quarter left view showing face depth and wall bracket. No brand logo. " +
      PROMPT_CONSTRAINTS,
    three_quarter_right:
      "Photoreal product photography of a wall-mounted clinical exam-room analog clock. Three-quarter right view showing face depth and wall bracket. No brand logo. " +
      PROMPT_CONSTRAINTS,
    side:
      "Photoreal product photography of a wall-mounted clinical exam-room analog clock. True side profile showing thin disk edge and wall-mount bracket. No logos. " +
      PROMPT_CONSTRAINTS,
  },
  "bedside-monitor": {
    front:
      "Photoreal orthographic product photography of a multi-parameter bedside patient monitor. Front view. Blank dark screen, unlabeled soft-touch buttons, light gray housing. " +
      PROMPT_CONSTRAINTS,
    three_quarter_left:
      "Photoreal product photography of a multi-parameter bedside patient monitor. Three-quarter left view. Blank dark screen, light gray housing, no logos. " +
      PROMPT_CONSTRAINTS,
    three_quarter_right:
      "Photoreal product photography of a multi-parameter bedside patient monitor. Three-quarter right view. Blank dark screen, light gray housing, no logos. " +
      PROMPT_CONSTRAINTS,
    side:
      "Photoreal product photography of a multi-parameter bedside patient monitor. True side profile. Thin housing silhouette, blank screen edge, no logos. " +
      PROMPT_CONSTRAINTS,
  },
};

function repoRel(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join("/");
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function listPngViews(subjectDir: string): ViewEntry[] {
  if (!existsSync(subjectDir)) return [];
  const files = readdirSync(subjectDir).filter(
    (f: string) => f.endsWith(".png") && f !== "contact-sheet.png" && !f.includes("_alt"),
  );
  const entries: ViewEntry[] = [];
  for (const file of files) {
    const abs = path.join(subjectDir, file);
    const st = statSync(abs);
    if (!st.isFile()) continue;
    const view = file.replace(/\.png$/i, "");
    const subjectId = path.basename(subjectDir);
    const prompt =
      PROMPTS[subjectId]?.[view] ??
      `Grok Imagine multi-view reference of ${subjectId} (${view}). ${PROMPT_CONSTRAINTS}`;
    entries.push({
      view,
      path: repoRel(abs),
      bytes: st.size,
      prompt,
      seed: null,
    });
  }
  // Prefer required-view order, then any extras.
  const order = new Map(REQUIRED_VIEWS.map((v, i) => [v, i]));
  entries.sort((a, b) => {
    const ai = order.has(a.view as ViewLabel) ? order.get(a.view as ViewLabel)! : 100;
    const bi = order.has(b.view as ViewLabel) ? order.get(b.view as ViewLabel)! : 100;
    if (ai !== bi) return ai - bi;
    return a.view.localeCompare(b.view);
  });
  return entries;
}

function loadSubjectPack(spec: SubjectSpec): PackEntry {
  const dirAbs = path.join(EVIDENCE_DIR, spec.dirName);
  const views = listPngViews(dirAbs);
  const contactAbs = path.join(dirAbs, "contact-sheet.png");
  return {
    subjectId: spec.subjectId,
    displayName: spec.displayName,
    dir: repoRel(dirAbs),
    views,
    contactSheetPath: existsSync(contactAbs) ? repoRel(contactAbs) : null,
  };
}

/**
 * Build / refresh manifest.json from on-disk packs.
 * Safe to call repeatedly; does not regenerate images.
 */
export function writeEquipmentGrokMultiviewManifest(
  packs: PackEntry[] = DEFAULT_SUBJECTS.map(loadSubjectPack),
  generatedAt = new Date().toISOString(),
): EquipmentGrokMultiviewManifest {
  ensureDir(EVIDENCE_DIR);
  const manifest: EquipmentGrokMultiviewManifest = {
    schemaVersion: "openclinxr.equipment-grok-multiview-sheets.v1",
    issue: "232",
    factoryStep: "equipment_generate",
    generatedAt,
    generator: {
      tool: "image_gen",
      harness: "grok",
      note:
        "Multi-view packs authored via harness image_gen (Grok Imagine) in a worktree-bound " +
        "session for issue #232. JPG session outputs converted to PNG under " +
        `${EVIDENCE_REL}/. Seeds not exposed by image_gen; recorded as null.`,
    },
    claimScope: [...CLAIM_SCOPE],
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
    subjects: packs,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

/**
 * Inspect on-disk multi-view packs. Refreshes the manifest so paths/bytes stay current.
 * Contract entrypoint for planted REDs in equipment-grok-multiview-sheets.test.ts.
 */
export async function inspectEquipmentGrokMultiviewSheets(): Promise<EquipmentGrokMultiviewReport> {
  const packsDetail = DEFAULT_SUBJECTS.map(loadSubjectPack);
  // Always rewrite manifest so a cold tree with packs still gets a valid manifest,
  // and so byte counts reflect current files.
  const manifest = writeEquipmentGrokMultiviewManifest(packsDetail);

  const packs = packsDetail.map((p) => {
    const viewPaths = p.views.map((v) => v.path);
    const minBytes =
      p.views.length === 0 ? 0 : Math.min(...p.views.map((v) => v.bytes));
    return {
      subjectId: p.subjectId,
      views: viewPaths,
      minBytes,
    };
  });

  // Prefer the written path; fall back to relative constant for contract flexibility.
  const manifestPath = existsSync(MANIFEST_PATH) ? MANIFEST_REL : manifest.subjects.length
    ? MANIFEST_REL
    : MANIFEST_REL;

  return {
    subjects: packsDetail.map((p) => p.subjectId),
    manifestPath,
    packs,
    claimScope: [...CLAIM_SCOPE],
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
    packsDetail,
  };
}

/** CLI: refresh manifest / print inspect JSON. */
async function main(): Promise<void> {
  const report = await inspectEquipmentGrokMultiviewSheets();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const ok =
    report.subjects.length >= 3 &&
    report.packs.every((p) => p.views.length >= 4 && p.minBytes > 5000) &&
    existsSync(path.join(EVIDENCE_DIR, "ecg-cart", "front.png"));
  if (!ok) {
    process.stderr.write(
      "equipment-grok-multiview-sheets: packs incomplete or under-sized; see report.\n",
    );
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
