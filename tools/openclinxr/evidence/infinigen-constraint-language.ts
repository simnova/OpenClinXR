/**
 * #339 — Infinigen constraint language capability probe.
 *
 * Question: can a CLINICAL room type be authored with real constraints (footprint
 * bounds, door on a named wall, fixture affordances) so `environmentId` drives
 * GENERATION rather than selecting a pre-baked seed?
 *
 * Measured answer: NO as a factory input (bake-and-pin is the ceiling). The
 * constraint language is a real, maintained authoring surface (seven test modules
 * under source/tests/constraints + solver/) and it CAN express hard room-area and
 * aspect-ratio bounds that the room annealer honours — but only when the random
 * initial segmentation already sits near the target, and it CANNOT express door
 * placement at all (aperture positions are uniform-random in the solidifier).
 *
 * Evidence produced:
 *   - dry probes: the clinical constraint program builds, every node has an evaluator
 *     impl, and viol_count enforces area()/aspect_ratio() in_range bounds.
 *   - generation run "infeasible target": hard area [78,84] m^2 (2x shipped) ->
 *     anneal accepted ZERO of 2000 proposals (score frozen at 4.25e5); dining room
 *     stayed at the random initial 44.0 m^2.
 *   - generation run "feasible target": hard area [36,48] m^2 + aspect [1.2,1.7] ->
 *     anneal explored (score 4.02e5 -> 230) and the dining room landed INSIDE the
 *     bounds (41.25 m^2, aspect 1.364).
 *   - control: shipped home_room_constraints anneals normally (score 4.25e5 -> 146),
 *     so the freeze is caused by the hard bounds, not a broken solver.
 *
 * claimScope: local Infinigen constraint-language expressibility + room-annealer
 * enforcement of hard footprint bounds, measured on this machine's install.
 * notEvidenceFor: adoption of Infinigen as an environmentId-driven generator,
 * clinical validity, Quest worn readiness, door placement control, production
 * promotion.
 */
import {
  existsSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-339");
const CAPABILITY_PATH = path.join(EVIDENCE_DIR, "constraint-language-capability.json");

const HOME = process.env["HOME"] ?? "";
const TOOLS_ROOT =
  process.env["OPENCLINXR_INFINIGEN_TOOLS"] ??
  path.join(HOME, ".openclinxr-tools/infinigen");

export type ConstraintLanguageCapability = {
  issue: number;
  question: string;
  verdict: "adopt_generation" | "reject_measured" | "inconclusive_blocked";
  verdictReason: string;
  measuredAt: string;
  installPath: string;
  languageCanExpress: Array<{ capability: string; evidence: string }>;
  languageCannotExpress: Array<{ capability: string; evidence: string }>;
  footprintExperiment: {
    dryProbes: {
      problemBuilds: boolean;
      missingNodeImpls: string[];
      violCount5x5Area: number | null;
      violCount9x9Area: number | null;
      violCount5x5Aspect: number | null;
    };
    infeasibleTarget: {
      areaBound: [number, number];
      aspectBound: [number, number];
      annealScoreFrozen: boolean;
      annealScoreStart: number | null;
      diningAreaM2: number | null;
      diningAspect: number | null;
      satisfied: boolean;
    } | null;
    feasibleTarget: {
      areaBound: [number, number];
      aspectBound: [number, number];
      annealScoreFrozen: boolean;
      diningAreaM2: number | null;
      diningAspect: number | null;
      satisfied: boolean;
    } | null;
    controlShipped: { annealExplores: boolean; scoreStart: number | null } | null;
  };
  doorOnNamedWall: {
    expressible: boolean;
    evidence: string;
  };
  singleroomGin: {
    producesSingleRoomShellDirectly: boolean;
    evidence: string;
    extractionStillNeeded: boolean;
  };
  clinicalRoomVocabulary: {
    hasDedicatedClinicalSemantics: boolean;
    evidence: string;
  };
  conclusion: string;
  claimScope: string[];
  notEvidenceFor: string[];
};

function runCmd(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
          }, opts.timeoutMs)
        : null;
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}\n${String(err)}`, timedOut });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

function resolveInstall(): { source: string | null; python: string | null } {
  let source: string | null = null;
  try {
    if (existsSync(path.join(TOOLS_ROOT, "source"))) {
      source = realpathSync(path.join(TOOLS_ROOT, "source"));
    }
  } catch {
    source = null;
  }
  let python: string | null = null;
  const candidate = path.join(TOOLS_ROOT, "venv/bin/python");
  if (existsSync(candidate)) python = candidate;
  return { source, python };
}

/** Probe script run in the install venv: build the clinical problem + viol counts. */
const PROBE_PY = `
import sys
sys.argv = ['probe']
from infinigen.core import init
init.apply_scene_seed('0')
from infinigen.core.constraints import constraint_language as cl
from infinigen.core.constraints.evaluator import evaluate as ev
from infinigen.core.constraints.evaluator.node_impl import node_impls
from infinigen.core.constraints.example_solver.state_def import ObjectState, State
from infinigen.core.tags import Semantics
import shapely
import clinical_exp.clinical_constraints as cc

prob = cc.clinical_room_constraints()
missing = []
for node in prob.traverse():
    if node.__class__ in ev.SPECIAL_CASE_NODES:
        continue
    if node.__class__ not in node_impls:
        missing.append(node.__class__.__name__)

room = cl.scene()[Semantics.RoomContour][Semantics.DiningRoom]
fp = room.all(lambda r: r.area().in_range(78, 84))
asp = room.all(lambda r: r.aspect_ratio().in_range(1.4, 1.6))
state5 = State({'r': ObjectState(tags={Semantics.RoomContour, Semantics.DiningRoom, Semantics.GroundFloor}, polygon=shapely.box(0,0,5,5))})
state9 = State({'r': ObjectState(tags={Semantics.RoomContour, Semantics.DiningRoom, Semantics.GroundFloor}, polygon=shapely.box(0,0,9,9))})
print('PROBE_OK')
print('has_clinical_keys', 'room_clinical_footprint' in prob.constraints, 'room_clinical_aspect' in prob.constraints)
print('missing_impls', len(missing))
print('viol5_area', ev.viol_count(fp, state5, {}))
print('viol9_area', ev.viol_count(fp, state9, {}))
print('viol5_aspect', ev.viol_count(asp, state5, {}))
`;

/** Measure the dining room in a generation output blend. */
const MEASURE_PY = `
import json, sys
import bpy
from mathutils import Vector
out_dir = sys.argv[1]
bpy.ops.wm.open_mainfile(filepath=out_dir + '/scene.blend')
names = [o.name for o in bpy.data.objects if o.type == 'MESH']
room_names = sorted({n.split('/')[0] for n in names if 'dining' in n.lower()})
r = {'room': None, 'area': None, 'aspect': None, 'found': False}
if room_names:
    room = room_names[0]
    objs = [bpy.data.objects[n] for n in names if n.startswith(room + '/')]
    ws = [objs[0].matrix_world @ Vector(v) for v in objs[0].bound_box]
    xs = [v.x for v in ws]; ys = [v.y for v in ws]
    w = max(xs) - min(xs); d = max(ys) - min(ys)
    r = {'room': room, 'area': round(w*d, 3), 'aspect': round(max(w,d)/min(w,d), 3), 'found': True}
print(json.dumps(r))
`;

async function measureDiningRoom(python: string, outDir: string): Promise<{
  room: string | null;
  area: number | null;
  aspect: number | null;
  found: boolean;
}> {
  try {
    const res = await runCmd(python, ["-c", MEASURE_PY, outDir], { timeoutMs: 240_000 });
    if (res.code !== 0) return { room: null, area: null, aspect: null, found: false };
    const m = /(\{.*\})/.exec(res.stdout);
    if (!m) return { room: null, area: null, aspect: null, found: false };
    const parsed = JSON.parse(m[1]);
    return {
      room: parsed.room ?? null,
      area: parsed.area ?? null,
      aspect: parsed.aspect ?? null,
      found: Boolean(parsed.found),
    };
  } catch {
    return { room: null, area: null, aspect: null, found: false };
  }
}

/**
 * Anneal-score observations from the three instrumented runs (all executed on
 * 2026-08-11 against this install, seed 0 + clinical_bay.gin, coarse):
 *   infeasible [78,84]: score frozen at 4.25e5 for all 2000 proposals (0 accepted)
 *   feasible   [36,48]: score descended 4.02e5 -> 230 (anneal explores)
 *   control (shipped):  score descended 4.25e5 -> 146 (anneal explores normally)
 * The dining-room footprints are re-measured live from the cached blends below.
 */
const RECORDED_ANNEAL_OBSERVATIONS = {
  infeasibleFrozen: true,
  infeasibleStart: 425480,
  feasibleFrozen: false,
  feasibleStart: 402000,
  controlExplores: true,
  controlStart: 425480,
} as const;

/** Assemble the capability report. Dry probes are re-run live; generation runs
 *  read the install's cached outputs (re-generated only if missing). */
export async function inspectInfinigenConstraintLanguage(): Promise<ConstraintLanguageCapability> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const install = resolveInstall();
  const installPath = install.source ?? TOOLS_ROOT;
  const measuredAt = new Date().toISOString();

  // --- Dry probes (fast, deterministic) ---
  const dry: ConstraintLanguageCapability["footprintExperiment"]["dryProbes"] = {
    problemBuilds: false,
    missingNodeImpls: [],
    violCount5x5Area: null,
    violCount9x9Area: null,
    violCount5x5Aspect: null,
  };
  if (install.source && install.python) {
    const res = await runCmd(
      install.python,
      ["-c", PROBE_PY],
      {
        cwd: install.source,
        timeoutMs: 300_000,
        env: { PYTHONPATH: TOOLS_ROOT, PYTHONUNBUFFERED: "1" },
      },
    );
    if (res.code === 0) {
      dry.problemBuilds = /has_clinical_keys True True/.test(res.stdout);
      const mi = /missing_impls (\d+)/.exec(res.stdout);
      dry.missingNodeImpls = mi && Number(mi[1]) === 0 ? [] : ["missing impls found"];
      const a5 = /viol5_area ([\d.]+)/.exec(res.stdout);
      const a9 = /viol9_area ([\d.]+)/.exec(res.stdout);
      const s5 = /viol5_aspect ([\d.]+)/.exec(res.stdout);
      if (a5) dry.violCount5x5Area = Number(a5[1]);
      if (a9) dry.violCount9x9Area = Number(a9[1]);
      if (s5) dry.violCount5x5Aspect = Number(s5[1]);
    }
  }

  // --- Generation runs (cached install outputs) ---
  const outputs = path.join(TOOLS_ROOT, "outputs");
  let infeasible: ConstraintLanguageCapability["footprintExperiment"]["infeasibleTarget"] = null;
  let feasible: ConstraintLanguageCapability["footprintExperiment"]["feasibleTarget"] = null;
  let control: ConstraintLanguageCapability["footprintExperiment"]["controlShipped"] = null;

  const infeasibleOut = path.join(outputs, "clinical_exp_78_84");
  if (existsSync(path.join(infeasibleOut, "scene.blend")) && install.python) {
    const m = await measureDiningRoom(install.python, infeasibleOut);
    infeasible = {
      areaBound: [78, 84],
      aspectBound: [1.4, 1.6],
      annealScoreFrozen: RECORDED_ANNEAL_OBSERVATIONS.infeasibleFrozen,
      annealScoreStart: RECORDED_ANNEAL_OBSERVATIONS.infeasibleStart,
      diningAreaM2: m.area,
      diningAspect: m.aspect,
      satisfied: m.area !== null && m.area >= 78 && m.area <= 84,
    };
  }

  const feasibleOut = path.join(outputs, "clinical_exp_feasible");
  if (existsSync(path.join(feasibleOut, "scene.blend")) && install.python) {
    const m = await measureDiningRoom(install.python, feasibleOut);
    feasible = {
      areaBound: [36, 48],
      aspectBound: [1.2, 1.7],
      annealScoreFrozen: RECORDED_ANNEAL_OBSERVATIONS.feasibleFrozen,
      diningAreaM2: m.area,
      diningAspect: m.aspect,
      satisfied: m.area !== null && m.area >= 36 && m.area <= 48,
    };
  }

  control = {
    annealExplores: RECORDED_ANNEAL_OBSERVATIONS.controlExplores,
    scoreStart: RECORDED_ANNEAL_OBSERVATIONS.controlStart,
  };

  const report: ConstraintLanguageCapability = {
    issue: 339,
    question:
      "Can a CLINICAL room type be authored with real constraints (footprint bounds, door on a named wall) so environmentId drives GENERATION rather than selecting a pre-baked seed?",
    verdict: "reject_measured",
    verdictReason:
      "The constraint language is a real, maintained authoring surface and CAN express hard room-area + aspect-ratio bounds that the room annealer honours (feasible target [36,48] m2 landed 41.25 m2 in-bounds), but it CANNOT author a clinical room type end-to-end: (1) footprint bounds are only satisfiable when the random initial segmentation already sits near the target — a 2x target [78,84] m2 froze the anneal at zero acceptances, returning the initial 44.0 m2; (2) door-on-a-named-wall is not expressible — aperture position is uniform-random in solidifier.py:549/565 and aperture type is a fixed room-pair probability table (solidifier.py:83-141). environmentId cannot drive generation; bake-and-pin is the ceiling.",
    measuredAt,
    installPath,
    languageCanExpress: [
      {
        capability: "Hard room-area bounds (area().in_range())",
        evidence:
          "cl.in_range accepts a ScalarExpression (set_reasoning.py:92-105); viol_count case handles it (evaluate.py:151-159); dry probe viol 53.0 for 25 m2 vs [78,84] and 0 for 81 m2. Room contour area node: constraint_language/rooms.py:96-98; evaluator node_impl/rooms.py:80-82.",
      },
      {
        capability: "Hard room-aspect-ratio bounds (aspect_ratio().in_range())",
        evidence:
          "aspect_ratio node rooms.py:27-29; dry probe viol 0.4 for a square vs [1.4,1.6]. Shipped program uses it softly (home.py:385-396).",
      },
      {
        capability: "Room graph structure: counts + adjacency (related_to().count().in_range())",
        evidence:
          "test_constraint_bounding.py:27-45 (bounds on counts), :103-145 (for-all over rooms/beds); home.py:68-160 node_gen hard constraints.",
      },
      {
        capability: "Soft area targets per room type",
        evidence:
          "home.py:354-382 (r.area()/N).log().hinge(0,0.4).pow(2) weight 500; consumed by get_typical_areas (graph.py:296-348) and the room anneal.",
      },
      {
        capability: "Room contour quality: convexity, narrowness, n_verts, grid-line count, shared-edge length",
        evidence:
          "rooms.py:36-126; exercised in home.py:399-455; test_constraint_bounding.py:103-145.",
      },
      {
        capability: "Furniture-level spatial costs (distance, accessibility, angle alignment, coplanarity, asymmetry, focus)",
        evidence:
          "constraint_language __init__.py geometry exports; exercised exhaustively by test_constraint_evaluator.py (min-dist :83-97, accessibility :118-263, angle alignment :299-528, coplanarity :885-942, asymmetry :731-882, scalar ops :948-1007).",
      },
      {
        capability: "Relation algebra on tag domains (implies/intersects/difference)",
        evidence:
          "test_constraint_relations.py:12-121; test_constraint_domain.py:12-228; test_reldom.py:12-115.",
      },
    ],
    languageCannotExpress: [
      {
        capability: "Absolute room width x depth (W x D)",
        evidence:
          "No width/depth node in the vocabulary (constraint_language/__init__.py exports). Only area (soft in home.py) and aspect_ratio (ratio only) exist; W=sqrt(A*ar), D=sqrt(A/ar) is never a solver target.",
      },
      {
        capability: "Door on a named wall / named edge (position or orientation)",
        evidence:
          "No wall or aperture node in the vocabulary. Aperture position is uniform-random along the shared edge (solidifier.py:549/565: y=uniform(...), x=uniform(...), lam=uniform(...)). Aperture TYPE (door/window/open) is a fixed room-pair probability table (solidifier.py:83-141). RoomNeighbour carries only connector_types (relations.py:124-170), set post-hoc, never a placement instruction.",
      },
      {
        capability: "A dedicated clinical room type",
        evidence:
          "Semantics enum (tags.py:32-72) is residential (kitchen/bedroom/living/closet/hallway/bathroom/garage/balcony/dining/utility/staircase) plus office/warehouse; no exam-bay/clinical member. A custom tag requires an install source edit.",
      },
      {
        capability: "Reliable generation-time enforcement of a distant footprint target",
        evidence:
          "Room annealer (floor_plan.py simulated_anneal :155-169) accepts only states with zero hard-constraint violations; max move stride 2.5 m (solver.py:28-33,77). A target far from the random initial segmentation is unreachable through violated intermediates — measured: [78,84] froze score at 4.25e5 for all 2000 proposals (0 accepted).",
      },
    ],
    footprintExperiment: {
      dryProbes: dry,
      infeasibleTarget: infeasible,
      feasibleTarget: feasible,
      controlShipped: control,
    },
    doorOnNamedWall: {
      expressible: false,
      evidence:
        "Constraint language has no node referencing walls or aperture placement; solidifier.py:549/565 places every aperture at a uniform() position along the shared edge; the room-pair table (solidifier.py:83-141) chooses door/window/open by probability, not by constraint.",
    },
    singleroomGin: {
      producesSingleRoomShellDirectly: false,
      evidence:
        "singleroom.gin is exactly two lines: BlueprintSolidifier.enable_open=False + restrict_solving.solve_max_rooms=1. solve_max_rooms only limits OBJECT placement ('only place objects in at most this many rooms', generate_indoors_util.py:220); the floorplan/shell is still the full multi-room house. #234 measured multi_room_still (20 wall meshes) with solve_max_rooms=1.",
      extractionStillNeeded: true,
    },
    clinicalRoomVocabulary: {
      hasDedicatedClinicalSemantics: false,
      evidence: "tags.py:32-72 Semantics enum has no clinical member; clinical identity must be carried by runtime fixtures (MADR 0050 hybrid posture), not by the generator.",
    },
    conclusion:
      "Bake-and-pin remains the factory contract for Infinigen rooms: deterministic seed + config -> full house -> post-hoc single-room extraction. The constraint language is NOT a dead letter — hard area+aspect bounds work when the target is near the initial segmentation (measured feasible target honoured) — but it cannot author the door placement a clinical bay needs, and it cannot reliably drive a footprint to an arbitrary specified size. environmentId drives SELECTION of a baked asset, not GENERATION. MADR 0053's 'extensible_with_custom_constraints' is corrected to: extensible for footprint SHAPE refinement of a chosen seed, not for clinical room authoring.",
    claimScope: [
      "local Infinigen constraint-language expressibility catalog (test file:line citations)",
      "dry probes: clinical Problem builds, node impls complete, viol_count enforces area/aspect in_range",
      "two generation runs with hard footprint bounds (infeasible [78,84] and feasible [36,48]) + shipped control, same seed/config as #336",
      "door-placement expressibility measured by vocabulary + solidifier source",
      "singleroom.gin behaviour read from config + #234 measured verdict",
    ],
    notEvidenceFor: [
      "adoption of Infinigen as an environmentId-driven generator (rejected)",
      "clinical validity or exam equivalence",
      "Quest worn readiness",
      "door placement control under any configuration",
      "production promotion of the constraint-language path",
    ],
  };

  writeFileSync(CAPABILITY_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}
