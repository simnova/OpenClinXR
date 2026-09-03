/**
 * Deterministic emotion → performance mapper (DVA-5).
 *
 * Direction: docs/openclinxr/runtime-dialogue-voice-affect-direction-2026-09-02.md:265-334.
 * Full key (dialogue + somatic + style + intensity + ageBand) → one performance
 * plan: face preset, pose preset, gesture clips, allowlisted prosody tags and
 * speed. DeepSeek output can never determine face / pose / gesture / prosody;
 * this module is the only render of those knobs.
 *
 * Fail-closed:
 *   - unknown dialogue emotion → neutral row (never throws, never mutates state);
 *   - unknown age band → no additive age-band forbids;
 *   - every emitted tag passes the global + emotion + age-band allowlist;
 *   - spokenText stays provider-markup-free (stripProviderMarkup); only the
 *     mapper adds provider markup, ≤1 wrap family + ≤1 inline tag per turn.
 *
 * claimScope: simulated_actor_behavior. notEvidenceFor: clinical affect
 * inference, empathy scoring, licensure.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PerformanceIntensityBucket = "low" | "mid" | "high";

/**
 * Mapper key boundary. The emotion/age cells are intentionally tolerant:
 * strict unions live in shared-schemas `ActorTurnPlanSchema` (validated at
 * plan-commit time). A cell outside the authored palette degrades to a
 * deterministic fallback row instead of crashing the render path.
 */
export type EmotionPerformanceMapperInput = {
  dialogueEmotion: string;
  /** "pain" is the only somatic touch-response emotion; anything else is "no somatic". */
  somaticEmotion?: string | null;
  /** Communication-profile style family (e.g. "satir"). Optional. */
  styleFamily?: string;
  /** Communication-profile style (e.g. "congruent"). Optional. */
  style?: string;
  intensityBucket: PerformanceIntensityBucket;
  ageBand: string;
  actorRole?: string;
};

export type EmotionPerformancePlan = {
  performancePlanId: string;
  /** Affective row that actually rendered (pain | dialogue row key). */
  rowKey: "pain" | "anxious" | "concerned" | "reassured" | "neutral";
  /** Key echo for Q4 traces: what the caller asked for. */
  dialogueEmotion: string;
  somaticEmotion: string | null;
  styleFamily?: string;
  style?: string;
  actorRole?: string;
  intensityBucket: PerformanceIntensityBucket;
  ageBand: string;
  facePresetId: string;
  posePresetId: string;
  /**
   * v1 emits no gesture clips. Runtime gesture selection belongs to this
   * mapper, but clip ids must point at authored/registered gesture assets;
   * inventing ids here would create replay references to nothing.
   */
  gestureClipIds: readonly string[];
  prosody: {
    wrapTags: readonly string[];
    inlineTags: readonly string[];
    /** 0.7–1.5; never feed a raw intensity float into TTS. */
    speed: number;
    droppedTags: readonly string[];
  };
  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};

// ---------------------------------------------------------------------------
// Prosody rows (allowlist v1, direction lines 295-318)
// ---------------------------------------------------------------------------

type ProsodyRow = {
  wrapTags: readonly string[];
  inlineTags: readonly string[];
  speed: number;
};

const PROSODY_ROWS: Readonly<Record<EmotionPerformancePlan["rowKey"], ProsodyRow>> = {
  neutral: { wrapTags: [], inlineTags: ["[pause]"], speed: 1.0 },
  reassured: { wrapTags: ["<soft>"], inlineTags: ["[exhale]", "[sigh]"], speed: 1.0 },
  concerned: { wrapTags: ["<soft>"], inlineTags: ["[pause]", "[sigh]"], speed: 1.0 },
  /**
   * Direction maps `<higher-pitch>` to ≤6-word emphasis clauses and `<soft>`
   * otherwise; that split needs the spoken clause, which lives at plan-build
   * time (DVA-6), not in the mapper key. The deterministic baseline is
   * `<soft>`; the builder may narrow anxious wraps to `<higher-pitch>`.
   */
  anxious: { wrapTags: ["<soft>"], inlineTags: ["[breath]", "[inhale]"], speed: 0.95 },
  /** Pain row speed pin 0.85 (direction range 0.85–0.90). */
  pain: { wrapTags: ["<soft>"], inlineTags: ["[breath]", "[exhale]", "[pause]"], speed: 0.85 },
};

const DIALOGUE_ROW_KEYS = ["anxious", "concerned", "reassured", "neutral"] as const;

// ---------------------------------------------------------------------------
// Tag allowlist / forbids (direction lines 288-318)
// ---------------------------------------------------------------------------

/** Global forbid on pain / anxious affect rows. */
const PAIN_OR_ANXIOUS_FORBIDDEN: readonly string[] = [
  "[cry]",
  "<loud>",
  "<build-intensity>",
  "[hum-tune]",
  "<sing-song>",
  "<singing>",
  "[lip-smack]",
  "[tongue-click]",
  "[tsk]",
  "[giggle]",
];

/** Additional forbids on the pain row only. */
const PAIN_FORBIDDEN_EXTRA: readonly string[] = ["[laugh]"];

/** Age-band additive forbids (direction lines 305-314). */
const AGE_BAND_FORBIDDEN: Readonly<Record<string, readonly string[]>> = {
  child: [
    "[cry]",
    "[giggle]",
    "[laugh]",
    "[chuckle]",
    "<loud>",
    "<build-intensity>",
    "<sing-song>",
    "<singing>",
    "[hum-tune]",
    "[lip-smack]",
    "[tongue-click]",
    "[tsk]",
    "<whisper>",
  ],
  adolescent: [
    "[cry]",
    "[giggle]",
    "[laugh]",
    "[chuckle]",
    "<loud>",
    "<build-intensity>",
    "<sing-song>",
    "<singing>",
    "[hum-tune]",
    "[lip-smack]",
    "[tongue-click]",
    "[tsk]",
    "<whisper>",
  ],
  /** No live [cry]; sobs are reviewed assets. */
  adult: ["[cry]"],
  "adult-parent": [],
};

function forbiddenTagsFor(
  rowKey: EmotionPerformancePlan["rowKey"],
  ageBand: string,
): readonly string[] {
  const ageForbids = AGE_BAND_FORBIDDEN[ageBand] ?? [];
  const affectForbids =
    rowKey === "pain" || rowKey === "anxious" ? PAIN_OR_ANXIOUS_FORBIDDEN : [];
  const painExtra = rowKey === "pain" ? PAIN_FORBIDDEN_EXTRA : [];
  return [...ageForbids, ...affectForbids, ...painExtra];
}

function firstAllowed(
  candidates: readonly string[],
  forbidden: readonly string[],
  dropped: string[],
): string | null {
  for (const tag of candidates) {
    if (forbidden.includes(tag)) {
      dropped.push(tag);
      continue;
    }
    return tag;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Row resolution
// ---------------------------------------------------------------------------

function resolveRowKey(input: EmotionPerformanceMapperInput): {
  rowKey: EmotionPerformancePlan["rowKey"];
  fromSomatic: boolean;
} {
  if (input.somaticEmotion === "pain") return { rowKey: "pain", fromSomatic: true };
  const dialogue = input.dialogueEmotion;
  if ((DIALOGUE_ROW_KEYS as readonly string[]).includes(dialogue)) {
    return { rowKey: dialogue as EmotionPerformancePlan["rowKey"], fromSomatic: false };
  }
  // Unknown dialogue cell → neutral row (fail-closed; state wins elsewhere).
  return { rowKey: "neutral", fromSomatic: false };
}

function buildPerformancePlanId(input: EmotionPerformanceMapperInput, rowKey: string): string {
  const styleFamily = input.styleFamily ?? "default";
  const style = input.style ?? "default";
  const actorRole = input.actorRole ?? "any";
  return `perf.v1.${rowKey}.${input.intensityBucket}.${styleFamily}.${style}.${input.ageBand}.${actorRole}`;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Map the full emotion/style/intensity/age key to one deterministic
 * performance plan. Pure: no wall clock, no RNG, same input → same plan.
 */
export function mapEmotionPerformance(
  input: EmotionPerformanceMapperInput,
): EmotionPerformancePlan {
  const { rowKey } = resolveRowKey(input);
  const row = PROSODY_ROWS[rowKey];
  const forbidden = forbiddenTagsFor(rowKey, input.ageBand);
  const droppedTags: string[] = [];

  const wrapTag = firstAllowed(row.wrapTags, forbidden, droppedTags);
  const inlineTag = firstAllowed(row.inlineTags, forbidden, droppedTags);

  const styleFamily = input.styleFamily;
  const style = input.style;
  const actorRole = input.actorRole;

  return {
    performancePlanId: buildPerformancePlanId(input, rowKey),
    rowKey,
    dialogueEmotion: input.dialogueEmotion,
    somaticEmotion: input.somaticEmotion ?? null,
    ...(styleFamily !== undefined ? { styleFamily } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(actorRole !== undefined ? { actorRole } : {}),
    intensityBucket: input.intensityBucket,
    ageBand: input.ageBand,
    facePresetId: `face.${rowKey}`,
    posePresetId: `pose.${rowKey}.${input.intensityBucket}`,
    gestureClipIds: [],
    prosody: {
      wrapTags: wrapTag === null ? [] : [wrapTag],
      inlineTags: inlineTag === null ? [] : [inlineTag],
      speed: row.speed,
      droppedTags,
    },
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: ["clinical_affect_inference", "empathy_score", "licensure"],
  };
}

// ---------------------------------------------------------------------------
// Provider-markup sanitation (direction lines 319-333)
// ---------------------------------------------------------------------------

/** Inline tags verified on POST /v1/tts (direction line 289). */
const INLINE_TAG_INVENTORY = [
  "pause",
  "long-pause",
  "hum-tune",
  "laugh",
  "chuckle",
  "giggle",
  "cry",
  "tsk",
  "tongue-click",
  "lip-smack",
  "breath",
  "inhale",
  "exhale",
  "sigh",
] as const;

/** Wrap tags verified on POST /v1/tts (direction line 290). */
const WRAP_TAG_INVENTORY = [
  "soft",
  "whisper",
  "loud",
  "build-intensity",
  "higher-pitch",
  "lower-pitch",
  "slow",
  "fast",
  "sing-song",
  "singing",
  "emphasis",
] as const;

const KNOWN_WRAP_NAMES: ReadonlySet<string> = new Set(WRAP_TAG_INVENTORY);
const KNOWN_INLINE_NAMES: ReadonlySet<string> = new Set(INLINE_TAG_INVENTORY);

export type ProviderMarkupStripped = {
  /** Provider-markup-free text (captions, replay transcript, traces). */
  cleanText: string;
  /** Recognized provider tags that were removed, in first-seen order. */
  droppedTags: readonly string[];
};

/**
 * Strip recognized xAI provider markup from generated/ authored text.
 * Only the verified inline/wrap inventories are removed; other brackets are
 * preserved so legitimate dialogue is not eaten (direction lines 319-321).
 */
export function stripProviderMarkup(text: string): ProviderMarkupStripped {
  const droppedTags: string[] = [];
  const drop = (tag: string): void => {
    if (!droppedTags.includes(tag)) droppedTags.push(tag);
  };

  // Wrap tags: <soft> … </soft> and bare <soft> tokens.
  const noWraps = text.replace(/<\/?([a-z][a-z-]*)>/gi, (match, name: string) => {
    if (KNOWN_WRAP_NAMES.has(name.toLowerCase())) {
      drop(`<${name.toLowerCase()}>`);
      return " ";
    }
    return match;
  });
  // Inline tags: [pause], [laugh], …
  const cleanText = noWraps
    .replace(/\[([a-z][a-z-]*)\]/g, (match, name: string) => {
      if (KNOWN_INLINE_NAMES.has(name.toLowerCase())) {
        drop(`[${name.toLowerCase()}]`);
        return " ";
      }
      return match;
    })
    .replace(/\s{2,}/g, " ")
    .trim();

  return { cleanText, droppedTags };
}
