import { describe, expect } from "vitest";

import { planted } from "./planted.js";
import {
  violationsInTracks,
  type CompiledMotionFragment,
  type PrimitiveRequest,
} from "./canonical-motion-contract.js";

/**
 * **OBSERVABLE: five planted clauses require `primitive-registry.ts` and no card owns it.**
 *
 * Card tsk_83d6573697a3cb3d. Found by external review at fdd7a47f, after the shared `PrimitiveRequest`
 * and `CompiledMotionFragment` types had closed the TYPE seam and left the FILE seam open.
 *
 * ## MEASURED ON HEAD — do not re-derive. This block is IMMUTABLE.
 *
 * Clauses requiring `./primitive-registry.js`, at 9d17481f:
 *
 *     the-primitive-registry-composes-four-behaviours.test.ts   (1) (2) (3) (4b)
 *     the-guard-primitive-hits-four-targets-on-three-rigs.ts    (2b)
 *     the-contact-constraint-holds-across-its-window.test.ts    (1b)
 *
 * M4 would have implemented it incidentally, while implementing four behaviours. M2 needs it to
 * register `guard_body_region`, which is NOT among M4's four ids. So M2 and M4 were described as
 * releasable siblings while a worker on M2 must wait for M4, edit M4's file concurrently, or build a
 * competing registry. A type contract does not resolve a file-ownership contract.
 *
 * ## THIS CARD IMPLEMENTS NO MOTION
 *
 * A registered stub returning a legal, EMPTY-tracks fragment is the correct output here. Every
 * behavioural clause stays with M2 (guard), M4 (the other four) and contacts. Those clauses are
 * expected to remain red after this card lands, and `probe:reds` records which reason each is red
 * for — a stage that moves is a manifest edit in the same land.
 *
 * ## OWNERSHIP IS EXCLUSIVE
 *
 * This card ALONE edits `primitive-registry.ts`. M2 and M4 own implementation MODULES and attach
 * through the slots this card establishes. If an implementation cannot be registered without editing
 * the central module, this card did not finish its job — and clause (5) is what makes that
 * mechanically true rather than a request.
 *
 * ## NOT TESTED, deliberately
 *
 * Whether any registered primitive produces useful motion. Whether the vocabulary is complete for
 * primitives nobody has designed (lip-sync, gaze, locomotion). Whether the shared machinery beneath
 * the five entries is well factored — clause (4)'s distinctness is an ALIASING guard and is NOT
 * evidence of separate underlying algorithms; shared solver and trajectory code below it is
 * desirable, and M4 clause (4b) carries the same boundary.
 */

const REGISTRY_MODULE = "./primitive-registry.js";

/** The complete vocabulary this seam must carry: M2's guard plus M4's four. */
const REQUIRED_PRIMITIVE_IDS = [
  "guard_body_region",
  "clutch_body_region",
  "reach_target",
  "look_at",
  "cough_recoil",
] as const;

type RegisteredPrimitive = { compile: (request: PrimitiveRequest) => CompiledMotionFragment };

type RegistryEntry = { id: string; primitive: RegisteredPrimitive };

type RegistryModule = {
  PRIMITIVE_IDS?: readonly string[];
  resolvePrimitive?: (id: string) => RegisteredPrimitive | undefined;
  /**
   * A PURE CONSTRUCTOR, not an import-time mutation. See clause (5) for why the mutable
   * `registerPrimitive` this contract first asked for was withdrawn.
   */
  createPrimitiveRegistry?: (entries: readonly RegistryEntry[]) => { resolvePrimitive: (id: string) => RegisteredPrimitive };
};

/** Resolve to an ABSOLUTE url so an absent module reports its real path, not a mangled one. */
function plantModule(specifier: string): string {
  return new URL(specifier, import.meta.url).href;
}

async function loadRegistry(): Promise<RegistryModule | undefined> {
  try {
    return (await import(/* @vite-ignore */ plantModule(REGISTRY_MODULE))) as RegistryModule;
  } catch {
    return undefined;
  }
}

const PROFILE = {
  rigFingerprint: "rig-fp-registry-seam",
  effectorBone: "handR",
  joints: [
    { boneName: "upper_armR", bindLocalPosition: { x: 0.18, y: 1.38, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
    { boneName: "forearmR", parentBoneName: "upper_armR", bindLocalPosition: { x: 0, y: -0.28, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
    { boneName: "handR", parentBoneName: "forearmR", bindLocalPosition: { x: 0, y: -0.26, z: 0 }, bindLocalQuaternion: { x: 0, y: 0, z: 0, w: 1 } },
  ],
};

function requestFor(primitiveId: string): PrimitiveRequest {
  return {
    action: {
      actionId: `action_${primitiveId}`,
      primitiveId,
      trigger: { kind: "clinical_touch", ref: "guard_rlq_v1" },
      timing: { durationMs: 900 },
      intensity: 0.6,
      target: { kind: "body_region", id: "motion_guard_abdomen_rlq" },
      effector: PROFILE.effectorBone,
      constraints: [],
    },
    skeletonProfile: structuredClone(PROFILE),
    seed: "seed-registry-seam",
  };
}

describe("the primitive registry is one seam with no behaviour", () => {
  planted("(1) RED: the vocabulary carries the guard AND the four behaviours, in one place", async () => {
    const registry = await loadRegistry();
    expect(
      Array.isArray(registry?.PRIMITIVE_IDS),
      `${REGISTRY_MODULE} must export PRIMITIVE_IDS — the vocabulary is the seam, and it does not exist yet`,
    ).toBe(true);

    const declared = new Set(registry!.PRIMITIVE_IDS!);
    for (const id of REQUIRED_PRIMITIVE_IDS) {
      expect(declared.has(id), `the vocabulary omits "${id}", so whoever needs it will add a second registry`).toBe(true);
    }
  });

  planted("(2) RED: every declared id resolves to something returning a CANONICAL fragment", async () => {
    const registry = await loadRegistry();
    expect(typeof registry?.resolvePrimitive, `${REGISTRY_MODULE} must export resolvePrimitive`).toBe("function");

    for (const id of REQUIRED_PRIMITIVE_IDS) {
      const primitive = registry!.resolvePrimitive!(id);
      expect(primitive, `the registry declares "${id}" and cannot resolve it`).toBeDefined();

      const fragment = primitive!.compile(requestFor(id));
      // The fragment must be one the canonical entry can consume. EMPTY TRACKS ARE FINE HERE — this
      // card implements no motion, and requiring content would push a foundation worker into writing
      // behaviour that M2 and M4 own.
      expect(
        violationsInTracks(fragment.tracks),
        `"${id}" returned tracks the canonical clip contract refuses`,
      ).toEqual([]);
      expect(
        fragment.actionId,
        `"${id}" did not attribute its fragment to the action it was given`,
      ).toBe(`action_${id}`);
    }
  });

  planted("(3) RED: an unknown id is REFUSED, not silently undefined", async () => {
    // `undefined` from a lookup is indistinguishable from "not registered yet" at every call site,
    // and the canonical entry's own clause (3) requires an unknown primitive to be refused rather
    // than skipped. A registry that returns undefined pushes that decision onto every caller.
    const registry = await loadRegistry();
    expect(typeof registry?.resolvePrimitive, `${REGISTRY_MODULE} must export resolvePrimitive`).toBe("function");
    expect(
      () => registry!.resolvePrimitive!("no_such_primitive_v0"),
      "an unknown primitive id resolved quietly — the caller cannot tell absent from unregistered",
    ).toThrow();
  });

  planted("(4) RED: resolution returns a DISTINCT entry per id — an aliasing guard, nothing more", async () => {
    // COUNTERWEIGHT to clauses (1)-(3), all of which a registry of five references to ONE stub
    // satisfies. Object identity, so it needs no behaviour and no source reading.
    //
    // CLAIM BOUNDARY, kept verbatim from the card: this is an ALIASING guard. It is NOT evidence of
    // separate underlying algorithms, and shared solver or trajectory machinery beneath these five
    // entries is desirable rather than a defect.
    const registry = await loadRegistry();
    expect(typeof registry?.resolvePrimitive, `${REGISTRY_MODULE} must export resolvePrimitive`).toBe("function");

    const compiles = REQUIRED_PRIMITIVE_IDS.map((id) => registry!.resolvePrimitive!(id)?.compile);
    expect(
      compiles.every((c) => typeof c === "function"),
      "not every declared id resolved to something with a compile",
    ).toBe(true);
    expect(
      new Set(compiles).size,
      `${REQUIRED_PRIMITIVE_IDS.length} ids resolved to ${new Set(compiles).size} distinct compile functions — they are aliases of one entry`,
    ).toBe(REQUIRED_PRIMITIVE_IDS.length);
  });

  planted("(5) RED: a duplicate id is REFUSED at construction, deterministically", async () => {
    // THE OWNERSHIP RULE, made mechanical — and REWRITTEN 2026-08-30 because the first version was
    // self-contradictory. It required a mutable `registerPrimitive("look_at", stub)` to SUCCEED as a
    // first registration, while clause (2) requires `look_at` to already resolve. In one module
    // instance both cannot hold, and a worker would have had to weaken a clause, add test-only state,
    // or invent lifecycle semantics to satisfy them. Caught by external review before dispatch.
    //
    // The repair is the architecture the card already preferred. The production registry is STATIC
    // and fully populated from stable module paths; there is no runtime registration surface at all,
    // so import order cannot decide who owns an id. M2 and M4 replace the BODIES of their own
    // placeholder implementation modules and never touch this one.
    //
    // Collision handling is then a property of a PURE CONSTRUCTOR over a deterministic input, which
    // is testable without any lifecycle: hand it two entries naming one id and it must refuse.
    const registry = await loadRegistry();
    expect(
      typeof registry?.createPrimitiveRegistry,
      `${REGISTRY_MODULE} must export createPrimitiveRegistry — collision handling has to be a property of a deterministic input, not of module evaluation order`,
    ).toBe("function");

    const stub = (marker: string): RegisteredPrimitive => ({
      compile: (request) => ({ actionId: `${(request.action as { actionId: string }).actionId}${marker}`, tracks: [] }),
    });

    expect(
      () =>
        registry!.createPrimitiveRegistry!([
          { id: "guard_body_region", primitive: stub("") },
          { id: "look_at", primitive: stub("") },
          { id: "guard_body_region", primitive: stub("-second") },
        ]),
      "two entries claimed one id and construction succeeded — ownership of an id would depend on input order",
    ).toThrow();

    // COUNTERWEIGHT: refusing EVERY construction satisfies the line above and makes the constructor
    // useless. Distinct ids must build, and the result must resolve them.
    const built = registry!.createPrimitiveRegistry!([
      { id: "guard_body_region", primitive: stub("-a") },
      { id: "look_at", primitive: stub("-b") },
    ]);
    expect(
      typeof built.resolvePrimitive,
      "the constructed registry does not resolve — the constructor refuses everything, or returns the wrong shape",
    ).toBe("function");
    expect(
      built.resolvePrimitive("look_at").compile(requestFor("look_at")).actionId,
      "the constructed registry resolved an id to the wrong entry",
    ).toBe("action_look_at-b");
  });
});
