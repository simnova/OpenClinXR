/**
 * THE CANONICAL COMPILE ENTRY — one function turns a MotionProgram and a SkeletonProfile into one
 * CompiledMotionClipV1.
 *
 * Card tsk_fd3856d1d8e23ec1 (the keystone). Every action in the program reaches a primitive — the
 * injected map when one is supplied, `resolvePrimitive` from the real registry otherwise — and every
 * fragment returns through one clip representation. Unknown primitive ids are REFUSED (never
 * silently skipped); a fragment attributed to a different action than the one that asked for it is
 * REFUSED (the clip's actionIds would otherwise stop meaning anything).
 *
 * CONTRACT THE PRIMITIVE SEAM IS PROVEN AGAINST: the request carries the FULL action and the FULL
 * skeletonProfile (no projection) plus a derived string seed, and the clip's `compileIdentity`
 * block records that seed — the same string each primitive received. Neither input is mutated.
 *
 * CLIP IDENTITY (issue #0): a program carries the case's request in provenance refs of the form
 * `touch:<ComplianceRegion>` — the authored touch site a reviewer traces back to. When refs name
 * exactly ONE declared compliance site, the clip realises one requested response clip and its
 * `clipId` IS that clip's name, derived by scenario-fixtures' `responseClipForBodyRegion` —
 * imported, never re-derived, so the bank row, the resolver and the compiler output share one
 * naming source. Any other program (no touch ref, a non-compliance token, or several distinct
 * sites in one compile) has no single requested identity and keeps the deterministic content id,
 * so a constant clipId and a bake-time rename adapter are both structurally unable to satisfy the
 * seam. The content digest identity remains available on the clip as `source.motionProgramHash`
 * and `targetRig.skeletonProfileHash`.
 *
 * NO VALIDATION GATE: this entry forwards, it does not judge. The MotionProgram validator belongs
 * to the planner card, and the keystone fixture deliberately authors a provenance kind that
 * validator refuses; gating on it here would red the contract this file exists to satisfy.
 */

import { createHash } from "node:crypto";

import {
  CLIP_SCHEMA_VERSION,
  type CompiledMotionFragment,
  type CompiledMotionTrack,
  type PrimitiveRequest,
} from "./canonical-motion-contract.js";
import { COMPLIANCE_TO_MOTION_REGION } from "./motion-body-region.js";
import { resolvePrimitive } from "./primitive-registry.js";
import { MOTION_PLAN_CLAIM_BOUNDARY, type MotionProgram } from "./motion-program.js";
import {
  canonicalMotionProgramHash,
  deterministicCompileIdentity,
} from "./program/compile-scenario-motion.js";
import { responseClipForBodyRegion } from "../../scenario-fixtures/src/touch-response-clip.js";

/** The exact clip shape the keystone freezes — one representation, imported by consumers. */
export type CompiledMotionClipV1 = {
  schemaVersion: typeof CLIP_SCHEMA_VERSION;
  clipId: string;
  source: { scenarioId: string; actorId: string; motionProgramHash: string; actionIds: string[] };
  targetRig: { rigFingerprint: string; skeletonProfileHash: string };
  compileIdentity: {
    compilerVersion: string;
    primitiveLibraryVersion: string;
    variationIndex: number;
    deterministicSeed: string;
  };
  durationSeconds: number;
  tracks: CompiledMotionTrack[];
  claimBoundary: string;
  notEvidenceFor: readonly string[];
};

export type CompileMotionProgramInput = {
  program: unknown;
  skeletonProfile: unknown;
  /** Compile FUNCTIONS keyed by primitiveId. When omitted, `resolvePrimitive` is used. */
  primitives?: Record<string, (r: PrimitiveRequest) => CompiledMotionFragment>;
};

const CLIP_NOT_EVIDENCE_FOR = [
  "clinical_validity",
  "scoring_validity",
  "production_asset_readiness",
  "quest_readiness",
] as const;

/** Recursive key-sorted serialisation: the same object hashes identically whatever its key order. */
function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(material: string): string {
  return createHash("sha256").update(material).digest("hex");
}

/**
 * The declared clinical touch sites, read from the compliance->motion table — the one place this
 * package declares the touch vocabulary. A provenance ref that names a region outside it is not a
 * case-requested touch, whatever prefix it carries.
 */
const DECLARED_COMPLIANCE_REGIONS: ReadonlySet<string> = new Set(
  COMPLIANCE_TO_MOTION_REGION.map((pair) => pair.compliance),
);

/** Provenance ref prefix for an authored touch: `touch:abdomen_rlq`. */
const TOUCH_REF_PREFIX = "touch:";

/**
 * The response clip a program asks for by provenance, when it asks for exactly one.
 *
 * A program compiled from case data carries the authored touch site in provenance refs of the form
 * `touch:<ComplianceRegion>`. When the refs name exactly one declared compliance site, the clip
 * realises ONE requested response clip and its id IS that clip's name — derived by the
 * scenario-fixtures resolver, which is imported rather than re-derived so the naming rule has a
 * single home. Any other program — no touch ref, a token that is not a compliance region, or
 * several distinct sites in one compile — has no single requested identity and returns undefined.
 */
function requestedClipIdForProgram(program: unknown): string | undefined {
  if (typeof program !== "object" || program === null) return undefined;
  const provenance = (program as { provenance?: unknown }).provenance;
  if (typeof provenance !== "object" || provenance === null) return undefined;
  const refs = (provenance as { sourceRefs?: unknown }).sourceRefs;
  if (!Array.isArray(refs)) return undefined;
  const requested = new Set<string>();
  for (const ref of refs) {
    if (typeof ref !== "string" || !ref.startsWith(TOUCH_REF_PREFIX)) continue;
    const region = ref.slice(TOUCH_REF_PREFIX.length);
    if (DECLARED_COMPLIANCE_REGIONS.has(region)) requested.add(region);
  }
  if (requested.size !== 1) return undefined;
  // Exactly one member; returning from the first (only) iteration needs no assertion.
  for (const region of requested) return responseClipForBodyRegion(region);
  return undefined;
}

/**
 * Compile every action of `program` against `skeletonProfile` into one deterministic clip.
 *
 * `program` and `skeletonProfile` are treated as immutable — read, never written.
 */
export function compileMotionProgram(input: CompileMotionProgramInput): CompiledMotionClipV1 {
  if (typeof input.program !== "object" || input.program === null) {
    throw new Error("compileMotionProgram: program must be an object");
  }
  const program = input.program as { scenarioId?: unknown; actorId?: unknown; actions?: unknown };
  const skeletonProfile = input.skeletonProfile;

  const scenarioId = typeof program.scenarioId === "string" ? program.scenarioId : "";
  const actorId = typeof program.actorId === "string" ? program.actorId : "";
  const actions = Array.isArray(program.actions) ? (program.actions as unknown[]) : [];

  // The program hash is the canonical one the seed contract names; the profile is hashed here
  // because a profile is not required to carry its own digest (rigFingerprint is not a hash).
  const motionProgramHash = canonicalMotionProgramHash(input.program as MotionProgram);
  const skeletonProfileHash = sha256Hex(canonicalJson(skeletonProfile));

  // The identity block IS the canonical five-input derivation; the seed it records is the same
  // string every primitive receives, so the clip's compileIdentity names what each action ran under.
  const compileIdentity = deterministicCompileIdentity({
    program: input.program as MotionProgram,
    skeletonProfileHash,
  });
  const seed = compileIdentity.deterministicSeed;

  const actionIds: string[] = [];
  const fragmentTracks: CompiledMotionTrack[] = [];

  for (const action of actions) {
    const actionId = (action as { actionId?: unknown }).actionId;
    if (typeof actionId !== "string" || actionId.length === 0) {
      throw new Error("compileMotionProgram: an action carries no string actionId — a fragment cannot be attributed");
    }
    const primitiveId = (action as { primitiveId?: unknown }).primitiveId;
    if (typeof primitiveId !== "string" || primitiveId.length === 0) {
      throw new Error(`compileMotionProgram: action "${actionId}" carries no primitiveId`);
    }

    const compileFn =
      input.primitives !== undefined ? resolveInjected(input.primitives, primitiveId) : resolvePrimitive(primitiveId).compile;

    const fragment = compileFn({ action, skeletonProfile, seed });
    if (typeof fragment !== "object" || fragment === null) {
      throw new Error(`compileMotionProgram: primitive "${primitiveId}" returned no fragment for action "${actionId}"`);
    }
    if (fragment.actionId !== actionId) {
      throw new Error(
        `compileMotionProgram: primitive "${primitiveId}" answered for actionId "${fragment.actionId}" but the program's action "${actionId}" asked — a fragment attributed to the wrong action is refused`,
      );
    }
    actionIds.push(actionId);
    fragmentTracks.push(...fragment.tracks);
  }

  // Deterministic ordering, so two identical compiles serialise identically whatever order the
  // fragments returned their tracks in.
  const tracks = [...fragmentTracks].sort((a, b) => {
    const keyA = `${a.boneName}::${a.property}`;
    const keyB = `${b.boneName}::${b.property}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  // Duration is a property of the composed clip, taken from the track times — one source for one
  // number, never a second number that can drift from the tracks it describes.
  const durationSeconds = tracks.reduce((max, track) => {
    const last = track.times[track.times.length - 1] ?? 0;
    return last > max ? last : max;
  }, 0);

  const rigFingerprint = (skeletonProfile as { rigFingerprint?: unknown }).rigFingerprint;

  return {
    schemaVersion: CLIP_SCHEMA_VERSION,
    // The requested identity when the program names one case touch site — the clip the case asks
    // for — and the deterministic content identity otherwise. Agreement with the scenario-fixtures
    // resolver is the seam this entry owns: a bake writes bytes under this id and a runtime finds
    // them by it.
    clipId:
      requestedClipIdForProgram(program) ?? sha256Hex(`${motionProgramHash}::${skeletonProfileHash}`),
    source: { scenarioId, actorId, motionProgramHash, actionIds },
    targetRig: {
      rigFingerprint: typeof rigFingerprint === "string" ? rigFingerprint : "",
      skeletonProfileHash,
    },
    compileIdentity,
    durationSeconds,
    tracks,
    claimBoundary: MOTION_PLAN_CLAIM_BOUNDARY,
    notEvidenceFor: CLIP_NOT_EVIDENCE_FOR,
  };
}

function resolveInjected(
  primitives: Record<string, (r: PrimitiveRequest) => CompiledMotionFragment>,
  primitiveId: string,
): (r: PrimitiveRequest) => CompiledMotionFragment {
  const injected = primitives[primitiveId];
  if (injected === undefined) {
    throw new Error(
      `compileMotionProgram: unknown primitive id "${primitiveId}" — no injected primitive with that id, and an injected map does not fall back to the registry`,
    );
  }
  return injected;
}
