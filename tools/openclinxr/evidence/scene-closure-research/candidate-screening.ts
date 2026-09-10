import { CANDIDATE_SOURCES, manifestRevisionProblems } from "./candidate-source-manifest.js";

/**
 * SC-10's eligibility engine for one pinned learned-motion candidate.
 *
 * Everything here derives from bytes that `retrieve-candidate-sources.ts` pulled from first-party
 * origins. The engine is deliberately unable to be TOLD a verdict: `screenCandidate` takes sources
 * and host facts, never a `verdict` field, so the only way to make it say `executed` is to hand it
 * an actual motion-inference observation.
 *
 * The card's counterweights are the specification, one function each:
 *
 * | counterweight | where it is enforced |
 * |---|---|
 * | wrong similarly named project | `screenIdentity` requires markers only this project's bytes carry |
 * | mismatched revisions | `manifestRevisionProblems` plus `screenRevisions` |
 * | inferred unseen skeleton | `screenSkeletonMapping` parses the class the checkpoint names |
 * | README/model-card mismatch hidden as certainty | `screenDocumentationDivergence` |
 * | unresolved data rights | `screenTrainingDataRights` |
 * | absent inference labeled performance | `qualifyingInferenceObservations` ignores every other kind |
 * | first-token HOLD/executed grading | a HOLD without a cited reason and a next unblock is refused |
 */

export type EvidenceLabel = "VERIFIED" | "INFERRED";

export type DimensionOutcome = "eligible" | "blocked" | "unresolved";

export type ScreeningDimensionId =
  | "candidate-identity"
  | "pinned-revisions"
  | "skeleton-mapping"
  | "documentation-divergence"
  | "body-and-encoder-terms"
  | "training-data-rights"
  | "output-terms"
  | "local-execution";

export type ScreeningDimension = {
  id: ScreeningDimensionId;
  outcome: DimensionOutcome;
  /** What was found, in terms a reader can check against the quoted source. */
  finding: string;
  /** VERIFIED means the bytes were read. INFERRED means it was reasoned from them. */
  label: EvidenceLabel;
  citedSourceIds: string[];
  /** Verbatim first-party text the finding rests on. Empty only when the finding is structural. */
  quote: string;
};

/**
 * An observation from actually running something.
 *
 * `kind` is load-bearing. The repo README offers `TEXT_ENCODER_DEVICE=cpu`, which moves ONLY the
 * text embedding model off the GPU; the denoiser still needs CUDA. A `text-encoder-offload`
 * observation therefore proves the offload works and proves nothing about motion generation, which
 * is the card's "no-inference performance claims" failure exactly.
 */
export type InferenceObservation = {
  observationId: string;
  kind: "motion-inference" | "text-encoder-offload" | "install-probe";
  metric: string;
  unit: string;
  value: number | string | boolean;
  source: string;
};

export type HostFacts = {
  platform: string;
  arch: string;
  cpuBrand: string;
  cudaDevicePresent: boolean;
};

export type ScreeningInput = {
  /** Retrieved bytes by sourceId. A missing required source is a refusal, never a default. */
  sources: ReadonlyMap<string, Buffer>;
  host: HostFacts;
  /** Empty on every branch where no run happened. It is never synthesised. */
  observations: readonly InferenceObservation[];
};

export type CandidateVerdict = "screened" | "executed" | "held";

export type ScreeningResult = {
  candidate: string;
  verdict: CandidateVerdict;
  dimensions: ScreeningDimension[];
  /** Non-empty exactly when the verdict is `held`. Each entry cites a source. */
  holdReasons: string[];
  /** The named action that would move this off HOLD. Required when held. */
  nextUnblock: string;
  /** Problems that make the whole screening untrustworthy rather than merely blocking. */
  refusals: string[];
};

export const SCREENED_CANDIDATE = "nvidia/Kimodo-SOMA (nv-tlabs/kimodo)";

/** Sources that must be present for a screening to mean anything. */
const REQUIRED_SOURCE_IDS = [
  "kimodo-repo-readme",
  "kimodo-skeleton-definitions",
  "kimodo-skeleton-exports",
  "kimodo-text-encoder-readme",
  "soma-rp-model-card",
  "soma-rp-model-licence",
  "soma-rp-checkpoint-config",
  "soma-seed-model-card",
  "soma-seed-checkpoint-config",
  "hf-index-text-encoder-base",
  "text-encoder-adapter-config",
] as const;

function text(input: ScreeningInput, sourceId: string): string {
  return input.sources.get(sourceId)?.toString("utf8") ?? "";
}

// ---------------------------------------------------------------------------- parsers

/** Collapse every run of whitespace, so a clause that spans a line break still matches. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ");
}

/** The skeleton class the checkpoint's own config instantiates, e.g. `SOMASkeleton30`. */
export function parseCheckpointSkeletonClass(configYaml: string): string | undefined {
  return /_target_:\s*kimodo\.skeleton\.(\w+)/u.exec(configYaml)?.[1];
}

/** The `num_frames x N x 3 x 3` joint count a model card declares for its output. */
export function parseModelCardOutputJoints(modelCard: string): number | undefined {
  const match = /Joint Rotations:\s*Four-Dimensional\s*\(`num_frames`\s*x\s*(\d+)\s*x\s*3\s*x\s*3\)/u.exec(modelCard);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** Bullet items under a bolded model-card heading, e.g. Supported Operating Systems. */
export function parseModelCardBullets(modelCard: string, heading: string): string[] {
  const index = modelCard.indexOf(heading);
  if (index < 0) return [];
  const rest = modelCard.slice(index + heading.length);
  const bullets: string[] = [];
  for (const line of rest.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("*")) bullets.push(trimmed.replace(/^\*\s*/u, "").trim());
    else if (bullets.length > 0 && trimmed !== "") break;
  }
  return bullets;
}

/** Class names the skeleton package exports at the pinned code revision. */
export function parseSkeletonExports(initPy: string): string[] {
  const block = /__all__\s*=\s*\[([\s\S]*?)\]/u.exec(initPy)?.[1] ?? "";
  return [...block.matchAll(/"([^"]+)"/gu)].map((match) => match[1] ?? "");
}

/**
 * The `(joint, parent)` chain declared on a named skeleton class.
 *
 * This reads the class the CHECKPOINT names. That is the difference between an inspected mapping
 * and the card's forbidden "inferred skeleton from uninspected weights": the joint list below is
 * transcribed from source, and its length is cross-checked against the model card's output shape.
 */
export function parseSkeletonJoints(definitionsPy: string, className: string): Array<[string, string | null]> {
  const classIndex = definitionsPy.indexOf(`class ${className}(`);
  if (classIndex < 0) return [];
  const body = definitionsPy.slice(classIndex);
  const block = /bone_order_names_with_parents\s*=\s*\[([\s\S]*?)\n\s{4}\]/u.exec(body)?.[1];
  if (block === undefined) return [];
  const joints: Array<[string, string | null]> = [];
  for (const match of block.matchAll(/\(\s*"([^"]+)"\s*,\s*(?:"([^"]+)"|None)\s*\)/gu)) {
    joints.push([match[1] ?? "", match[2] ?? null]);
  }
  return joints;
}

/** The skeleton name the repo README declares as the library's current input/output surface. */
export function parseReadmeIoSkeletonClaim(readme: string): { skeleton: string; line: string } | undefined {
  for (const line of readme.split("\n")) {
    const match = /Model inputs\/outputs now use the SOMA \d+-joint skeleton \(`(\w+)`\)/u.exec(line);
    if (match?.[1] !== undefined) return { skeleton: match[1], line: line.trim() };
  }
  return undefined;
}

/** The README's VRAM statement, including the CPU text-encoder offload knob. */
export function parseVramStatement(readme: string): string | undefined {
  return readme.split("\n").find((line) => /VRAM/u.test(line) && /TEXT_ENCODER_DEVICE/u.test(line))?.trim();
}

/** The text encoder the pinned code requires, as its own README names it. */
export function parseRequiredTextEncoder(encoderReadme: string): string | undefined {
  return /`([\w-]+\/[\w.-]+)`/u.exec(encoderReadme)?.[1];
}

/**
 * The base model a PEFT adapter is built on, read from the adapter's own config.
 *
 * An independent review caught this being hardcoded in the finding string while the dimension
 * carried a VERIFIED label. The chain was true, but "true and asserted" is not what VERIFIED means
 * on this card — so the adapter config is now a retrieved source and the id comes out of its bytes.
 */
export function parseAdapterBaseModel(adapterConfigJson: string): string | undefined {
  try {
    const parsed = JSON.parse(adapterConfigJson) as { base_model_name_or_path?: unknown };
    const base = parsed.base_model_name_or_path;
    return typeof base === "string" ? base : undefined;
  } catch {
    return undefined;
  }
}

/** HuggingFace's own gate field. `false` is open; anything else is a gate. */
export function parseGateStatus(indexJson: string): { gated: unknown; licence: unknown } {
  try {
    const parsed = JSON.parse(indexJson) as { gated?: unknown; cardData?: { license?: unknown } };
    return { gated: parsed.gated, licence: parsed.cardData?.license };
  } catch {
    return { gated: undefined, licence: undefined };
  }
}

/** Only a real motion run counts. Every other observation kind is dropped on the floor. */
export function qualifyingInferenceObservations(
  observations: readonly InferenceObservation[],
): InferenceObservation[] {
  return observations.filter((observation) => observation.kind === "motion-inference");
}

// ---------------------------------------------------------------------------- dimensions

function screenIdentity(input: ScreeningInput): ScreeningDimension {
  const readme = text(input, "kimodo-repo-readme");
  const exportsPy = text(input, "kimodo-skeleton-exports");
  // Markers only this project's bytes carry. `nghorbani/soma` is a different project with a
  // non-commercial research licence and none of these; a community port carries the name but not
  // the NVIDIA copyright header on the skeleton package.
  const hasVariantTable = readme.includes("Kimodo-SOMA-RP-v1.1") && readme.includes("Kimodo-SOMA-SEED-v1.1");
  const hasNvidiaHeader = exportsPy.includes("NVIDIA CORPORATION");
  const hasSkeletonExports = parseSkeletonExports(exportsPy).includes("SOMASkeleton30");
  if (hasVariantTable && hasNvidiaHeader && hasSkeletonExports) {
    return {
      id: "candidate-identity",
      outcome: "eligible",
      finding:
        "Sources are the NVIDIA nv-tlabs/kimodo project: the README carries the v1.1 variant table and "
        + "kimodo/skeleton/__init__.py carries the NVIDIA copyright header and exports SOMASkeleton30. "
        + "This is not nghorbani/soma (a different project under a non-commercial research licence) and "
        + "not a community port.",
      label: "VERIFIED",
      citedSourceIds: ["kimodo-repo-readme", "kimodo-skeleton-exports"],
      quote: "SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.",
    };
  }
  return {
    id: "candidate-identity",
    outcome: "blocked",
    finding:
      "Retrieved bytes do not carry this project's identity markers (v1.1 variant table, NVIDIA copyright "
      + "header, SOMASkeleton30 export). A similarly named project or port cannot be screened as this candidate.",
    label: "VERIFIED",
    citedSourceIds: ["kimodo-repo-readme", "kimodo-skeleton-exports"],
    quote: "",
  };
}

function screenRevisions(): ScreeningDimension {
  const problems = manifestRevisionProblems();
  if (problems.length === 0) {
    const pinned = CANDIDATE_SOURCES.filter((source) => !source.mutableIndex).length;
    return {
      id: "pinned-revisions",
      outcome: "eligible",
      finding:
        `The source MANIFEST pins ${pinned} of ${CANDIDATE_SOURCES.length} entries to an immutable 40-hex `
        + "revision; the remainder are availability indexes carrying a timestamped receipt and are not used to "
        + "establish terms. This dimension screens the manifest, not the retrieval: whether each object was "
        + "actually fetched from its pinned URL and still hashes to its receipt is enforced by "
        + "loadRetrievedSources and surfaces as sourceProblems, which fail the verifier separately.",
      label: "VERIFIED",
      citedSourceIds: ["kimodo-repo-readme", "soma-rp-checkpoint-config"],
      quote: "",
    };
  }
  return {
    id: "pinned-revisions",
    outcome: "blocked",
    finding: `Source manifest is not fully pinned: ${problems.join("; ")}`,
    label: "VERIFIED",
    citedSourceIds: [],
    quote: "",
  };
}

function screenSkeletonMapping(input: ScreeningInput): ScreeningDimension {
  const rpClass = parseCheckpointSkeletonClass(text(input, "soma-rp-checkpoint-config"));
  const seedClass = parseCheckpointSkeletonClass(text(input, "soma-seed-checkpoint-config"));
  const definitions = text(input, "kimodo-skeleton-definitions");
  if (rpClass === undefined || seedClass === undefined) {
    return {
      id: "skeleton-mapping",
      outcome: "unresolved",
      finding: "A checkpoint config did not declare a kimodo.skeleton class, so the mapping cannot be inspected.",
      label: "VERIFIED",
      citedSourceIds: ["soma-rp-checkpoint-config", "soma-seed-checkpoint-config"],
      quote: "",
    };
  }
  if (rpClass !== seedClass) {
    return {
      id: "skeleton-mapping",
      outcome: "blocked",
      finding: `The two pinned checkpoints declare different skeletons (${rpClass} vs ${seedClass}).`,
      label: "VERIFIED",
      citedSourceIds: ["soma-rp-checkpoint-config", "soma-seed-checkpoint-config"],
      quote: "",
    };
  }
  const joints = parseSkeletonJoints(definitions, rpClass);
  const declaredJoints = parseModelCardOutputJoints(text(input, "soma-rp-model-card"));
  if (joints.length === 0) {
    return {
      id: "skeleton-mapping",
      outcome: "unresolved",
      finding: `Class ${rpClass} was named by the checkpoint but its joint chain is absent from the retrieved source.`,
      label: "VERIFIED",
      citedSourceIds: ["kimodo-skeleton-definitions"],
      quote: "",
    };
  }
  if (declaredJoints !== joints.length) {
    return {
      id: "skeleton-mapping",
      outcome: "blocked",
      finding:
        `Model card declares ${String(declaredJoints)} output joints but the inspected ${rpClass} chain has `
        + `${joints.length}. The mapping cannot be trusted.`,
      label: "VERIFIED",
      citedSourceIds: ["kimodo-skeleton-definitions", "soma-rp-model-card"],
      quote: "",
    };
  }
  const roots = joints.filter(([, parent]) => parent === null).map(([joint]) => joint);
  return {
    id: "skeleton-mapping",
    outcome: "eligible",
    finding:
      `Both checkpoints declare ${rpClass}; its ${joints.length}-joint chain was read from source (root `
      + `${roots.join(", ")}) and matches the model card's num_frames x ${joints.length} x 3 x 3 output shape. `
      + "The mapping is inspected, not inferred from weights.",
    label: "VERIFIED",
    citedSourceIds: ["soma-rp-checkpoint-config", "kimodo-skeleton-definitions", "soma-rp-model-card"],
    quote: `_target_: kimodo.skeleton.${rpClass}`,
  };
}

/**
 * The README-versus-model-card question the card names, resolved before anything is called
 * incompatible.
 *
 * The repo README's 2026-03-19 entry says inputs/outputs now use `somaskel77`; the model cards say
 * 30. That reads as a contradiction and is not one — but saying so requires finding the conversion
 * in source. Without it, this stays `unresolved`, which is the honest state and blocks eligibility
 * rather than being reported either way as certainty.
 */
function screenDocumentationDivergence(input: ScreeningInput): ScreeningDimension {
  const claim = parseReadmeIoSkeletonClaim(text(input, "kimodo-repo-readme"));
  const checkpointClass = parseCheckpointSkeletonClass(text(input, "soma-rp-checkpoint-config"));
  const cardJoints = parseModelCardOutputJoints(text(input, "soma-rp-model-card"));
  if (claim === undefined || checkpointClass === undefined) {
    // Fails CLOSED, and this is the one dimension where that was not true.
    //
    // It used to return `eligible` here with the finding "no divergence is present in the retrieved
    // bytes" — an affirmative claim that a parse miss cannot support. An independent review measured
    // the consequence: reword the README line to "Model inputs and outputs now use the SOMA
    // 77-joint skeleton (somaskel77)" and the regex stops matching while the real 77-vs-30
    // divergence is untouched; the dimension reported eligible/VERIFIED and, on a CUDA host with an
    // ungated encoder, the verdict reached `screened`. That is the card's "README/model-card
    // mismatch hidden as certainty" counterweight, produced by this card's own code. Not being able
    // to read the statement is not evidence that there is nothing to read.
    return {
      id: "documentation-divergence",
      outcome: "unresolved",
      finding:
        `Cannot establish agreement: ${claim === undefined ? "the README's I/O skeleton statement did not parse" : ""}`
        + `${claim === undefined && checkpointClass === undefined ? " and " : ""}`
        + `${checkpointClass === undefined ? "the checkpoint config declared no skeleton class" : ""}`
        + ". Absence of a parsed divergence is not evidence that the documents agree.",
      label: "VERIFIED",
      citedSourceIds: ["kimodo-repo-readme", "soma-rp-checkpoint-config"],
      quote: "",
    };
  }
  const readmeJoints = Number(/\d+/u.exec(claim.skeleton)?.[0] ?? "0");
  if (readmeJoints === cardJoints) {
    return {
      id: "documentation-divergence",
      outcome: "eligible",
      finding: "README and model card agree on the joint count; there is nothing to reconcile.",
      label: "VERIFIED",
      citedSourceIds: ["kimodo-repo-readme", "soma-rp-model-card"],
      quote: claim.line,
    };
  }
  const definitions = text(input, "kimodo-skeleton-definitions");
  const exported = parseSkeletonExports(text(input, "kimodo-skeleton-exports"));
  const readmeClass = `SOMASkeleton${readmeJoints}`;
  const bridge = `output_to_${readmeClass}`;
  const bothExported = exported.includes(checkpointClass) && exported.includes(readmeClass);
  const hasBridge = definitions.includes(bridge);
  if (bothExported && hasBridge) {
    return {
      id: "documentation-divergence",
      outcome: "eligible",
      finding:
        `Resolved, and it is NOT an incompatibility. The README's "${claim.skeleton}" statement describes the `
        + `library's I/O surface; the model card's ${String(cardJoints)} describes the checkpoint's native joint `
        + `count. At the pinned code revision both ${checkpointClass} and ${readmeClass} are exported and `
        + `${checkpointClass}.${bridge} expands the ${String(cardJoints)}-joint output to ${readmeJoints} joints `
        + "by filling the relaxed-hand rest pose and re-running FK. The two documents describe different layers "
        + "of one pipeline, so neither is stale.",
      label: "VERIFIED",
      citedSourceIds: ["kimodo-repo-readme", "soma-rp-model-card", "kimodo-skeleton-definitions", "kimodo-skeleton-exports"],
      quote: claim.line,
    };
  }
  return {
    id: "documentation-divergence",
    outcome: "unresolved",
    finding:
      `The README declares ${claim.skeleton} I/O while the model card declares ${String(cardJoints)} joints, and `
      + `no ${bridge} conversion was found at the pinned code revision. The relationship is UNRESOLVED; it must not `
      + "be reported as either compatibility or incompatibility.",
    label: "VERIFIED",
    citedSourceIds: ["kimodo-repo-readme", "soma-rp-model-card", "kimodo-skeleton-definitions"],
    quote: claim.line,
  };
}

/**
 * Body and encoder terms, screened as separate components from the tool code.
 *
 * This is where the candidate actually fails. The denoiser is ungated, but the pinned code's text
 * encoder is a PEFT adapter over a base model that HuggingFace reports as manually gated.
 */
function screenBodyAndEncoderTerms(input: ScreeningInput): ScreeningDimension {
  const encoder = parseRequiredTextEncoder(text(input, "kimodo-text-encoder-readme"));
  const baseModel = parseAdapterBaseModel(text(input, "text-encoder-adapter-config"));
  const base = parseGateStatus(text(input, "hf-index-text-encoder-base"));
  const adapter = parseGateStatus(text(input, "hf-index-text-encoder-adapter"));
  if (encoder === undefined) {
    return {
      id: "body-and-encoder-terms",
      outcome: "unresolved",
      finding: "The pinned code does not name its text encoder in the retrieved bytes.",
      label: "VERIFIED",
      citedSourceIds: ["kimodo-text-encoder-readme"],
      quote: "",
    };
  }
  if (baseModel === undefined) {
    return {
      id: "body-and-encoder-terms",
      outcome: "unresolved",
      finding:
        `The encoder ${encoder} is a PEFT adapter, but its adapter_config.json did not declare a base model in `
        + "the retrieved bytes, so the transitive rights chain cannot be followed.",
      label: "VERIFIED",
      citedSourceIds: ["text-encoder-adapter-config"],
      quote: "",
    };
  }
  if (base.gated !== false) {
    return {
      id: "body-and-encoder-terms",
      outcome: "blocked",
      finding:
        `The pinned code requires ${encoder} for text encoding. That is a PEFT adapter (gated `
        + `${String(adapter.gated)}, licence ${String(adapter.licence)}) whose adapter_config.json declares base `
        + `model ${baseModel}, which HuggingFace reports as gated "${String(base.gated)}" under licence `
        + `"${String(base.licence)}". Obtaining it requires an account and acceptance of a licence this repository `
        + "does not hold. Accepting a new gated term is an owner decision, not this card's.",
      label: "VERIFIED",
      citedSourceIds: [
        "kimodo-text-encoder-readme",
        "text-encoder-adapter-config",
        "hf-index-text-encoder-base",
        "hf-index-text-encoder-adapter",
      ],
      quote:
        "This is a patched version of the original LLM2Vec codebase so that "
        + "`McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised` works with `transformers==5.0.0rc3`.",
    };
  }
  return {
    id: "body-and-encoder-terms",
    outcome: "eligible",
    finding: `Text encoder ${encoder} and its base model are both ungated.`,
    label: "VERIFIED",
    citedSourceIds: ["kimodo-text-encoder-readme", "hf-index-text-encoder-base"],
    quote: "",
  };
}

function screenTrainingDataRights(input: ScreeningInput): ScreeningDimension {
  const rpCard = text(input, "soma-rp-model-card");
  const seedCard = text(input, "soma-seed-model-card");
  const dataset = parseGateStatus(text(input, "hf-index-bones-seed-dataset"));
  const rpProprietary = rpCard.includes("Proprietary Bones Rigplay Dataset");
  const seedPublic = seedCard.includes("Public Bones-SEED Dataset");
  const datasetOpen = dataset.gated === false;
  if (rpProprietary && seedPublic && !datasetOpen) {
    return {
      id: "training-data-rights",
      outcome: "unresolved",
      finding:
        "Split by variant, and neither variant's data terms are first-party inspectable from here. RP is trained "
        + "on the \"Proprietary Bones Rigplay Dataset\" whose terms are not published. SEED is trained on the "
        + `"Public Bones-SEED Dataset", but that dataset is gated "${String(dataset.gated)}" on HuggingFace under `
        + `licence "${String(dataset.licence)}", so its licence text sits behind a gate this repository does not `
        + "hold. NVIDIA asserts provenance and commercial readiness on the model cards; that assertion was read "
        + "but not independently verified.",
      label: "VERIFIED",
      citedSourceIds: ["soma-rp-model-card", "soma-seed-model-card", "hf-index-bones-seed-dataset"],
      quote: "**Name**: Proprietary Bones Rigplay Dataset",
    };
  }
  if (rpProprietary && seedPublic && datasetOpen) {
    return {
      id: "training-data-rights",
      outcome: "eligible",
      finding: "The SEED variant's open training dataset and its licence text are reachable first-party.",
      label: "VERIFIED",
      citedSourceIds: ["soma-seed-model-card", "hf-index-bones-seed-dataset"],
      quote: "**Name**: Public Bones-SEED Dataset",
    };
  }
  return {
    id: "training-data-rights",
    outcome: "unresolved",
    finding: "The retrieved model cards do not name their training datasets in the expected form.",
    label: "VERIFIED",
    citedSourceIds: ["soma-rp-model-card", "soma-seed-model-card"],
    quote: "",
  };
}

function screenOutputTerms(input: ScreeningInput): ScreeningDimension {
  // Licence text is hard-wrapped at ~80 columns, so the output-ownership clause spans a line
  // break. Matching the raw bytes reported "no clear disclaimer" for a licence that carries one
  // verbatim, which would have been a HOLD reason invented by a parser rather than found in a
  // source. Collapse first, then match.
  const licence = collapseWhitespace(text(input, "soma-rp-model-licence"));
  const disclaimsOutputs = licence.includes("NVIDIA claims no ownership rights in outputs");
  const commercial = licence.includes("Models are commercially usable");
  const copyleft = /GNU (?:Affero )?General Public License|AGPL|GPL-3/u.test(licence);
  if (disclaimsOutputs && commercial && !copyleft) {
    return {
      id: "output-terms",
      outcome: "eligible",
      finding:
        "The NVIDIA Open Model License disclaims ownership of outputs and permits commercial use, and is not "
        + "copyleft. Two residuals are recorded rather than waved through: the grant is revocable under section "
        + "2.1 and NVIDIA may update the agreement, and acceptance is by USE rather than by click-through, so "
        + "running the model would bind this repository to terms it does not currently hold.",
      label: "VERIFIED",
      citedSourceIds: ["soma-rp-model-licence"],
      quote:
        "NVIDIA claims no ownership rights in outputs. You are responsible for outputs and their subsequent uses.",
    };
  }
  return {
    id: "output-terms",
    outcome: copyleft ? "blocked" : "unresolved",
    finding: copyleft
      ? "The model licence carries copyleft terms, which this repository refuses."
      : "The model licence does not clearly disclaim output ownership or permit commercial use.",
    label: "VERIFIED",
    citedSourceIds: ["soma-rp-model-licence"],
    quote: "",
  };
}

/**
 * Whether motion inference can run on THIS host.
 *
 * `qualifyingInferenceObservations` is the guard the card asks for by name: a successful CPU
 * text-encoder offload is not evidence that the denoiser ran, so it cannot reach this decision.
 */
function screenLocalExecution(input: ScreeningInput): ScreeningDimension {
  const card = text(input, "soma-rp-model-card");
  const operatingSystems = parseModelCardBullets(card, "**Supported Operating Systems:**");
  const microarchitectures = parseModelCardBullets(card, "**Supported Hardware Microarchitecture Compatibility:** <br>");
  const vram = parseVramStatement(text(input, "kimodo-repo-readme")) ?? "";
  const hostOs = input.host.platform === "darwin" ? "macOS" : input.host.platform;
  const osSupported = operatingSystems.some((entry) => entry.toLowerCase() === hostOs.toLowerCase());
  const nvidiaRequired = microarchitectures.every((entry) => entry.startsWith("NVIDIA"));
  if (osSupported && input.host.cudaDevicePresent) {
    return {
      id: "local-execution",
      outcome: "eligible",
      finding: `Host ${hostOs}/${input.host.arch} is a supported OS and a CUDA device is present.`,
      label: "VERIFIED",
      citedSourceIds: ["soma-rp-model-card"],
      quote: "",
    };
  }
  const reasons: string[] = [];
  if (!osSupported) {
    reasons.push(
      `the model card's supported operating systems are ${operatingSystems.join(", ")}, and this host is ${hostOs}`,
    );
  }
  if (!input.host.cudaDevicePresent) {
    reasons.push(
      `no CUDA device is present on ${input.host.cpuBrand}`
      + (nvidiaRequired
        ? `, while every supported microarchitecture is an NVIDIA one (${microarchitectures.join(", ")})`
        : ""),
    );
  }
  return {
    id: "local-execution",
    outcome: "blocked",
    finding:
      `Motion inference cannot run on this host: ${reasons.join("; ")}. The README's CPU offload does not change `
      + "this — it moves only the text embedding model and still leaves the denoiser needing GPU VRAM.",
    label: "VERIFIED",
    citedSourceIds: ["soma-rp-model-card", "kimodo-repo-readme"],
    quote: vram,
  };
}

// ---------------------------------------------------------------------------- verdict

/**
 * Screen the candidate and return a verdict the evidence supports.
 *
 * There is no argument by which a caller can assert the answer. `executed` is reachable only with a
 * qualifying motion-inference observation AND every dimension eligible; `screened` only with every
 * dimension eligible; everything else is `held`, and a `held` result with no cited reason or no next
 * unblock is downgraded to a refusal rather than returned as a tidy HOLD.
 */
export function screenCandidate(input: ScreeningInput): ScreeningResult {
  const refusals: string[] = [];
  for (const sourceId of REQUIRED_SOURCE_IDS) {
    const bytes = input.sources.get(sourceId);
    if (bytes === undefined) refusals.push(`required source ${sourceId} was not retrieved`);
    else if (bytes.byteLength === 0) refusals.push(`required source ${sourceId} is empty`);
  }

  const dimensions = [
    screenIdentity(input),
    screenRevisions(),
    screenSkeletonMapping(input),
    screenDocumentationDivergence(input),
    screenBodyAndEncoderTerms(input),
    screenTrainingDataRights(input),
    screenOutputTerms(input),
    screenLocalExecution(input),
  ];

  const blocking = dimensions.filter((dimension) => dimension.outcome !== "eligible");
  const qualifying = qualifyingInferenceObservations(input.observations);

  if (refusals.length > 0) {
    return {
      candidate: SCREENED_CANDIDATE,
      verdict: "held",
      dimensions,
      holdReasons: refusals,
      nextUnblock: "Re-run retrieve-candidate-sources.ts and confirm every required source returns HTTP 200.",
      refusals,
    };
  }

  if (blocking.length === 0) {
    if (qualifying.length > 0) {
      return {
        candidate: SCREENED_CANDIDATE,
        verdict: "executed",
        dimensions,
        holdReasons: [],
        nextUnblock: "",
        refusals: [],
      };
    }
    return {
      candidate: SCREENED_CANDIDATE,
      verdict: "screened",
      dimensions,
      holdReasons: [],
      nextUnblock:
        "Eligible and executable. Run the same frozen case/rig/target against the SC-06 baseline; the comparison "
        + "may not use a substitute baseline.",
      refusals: [],
    };
  }

  const holdReasons = blocking.map(
    (dimension) => `${dimension.id} (${dimension.outcome}): ${dimension.finding}`,
  );
  const blocked = blocking.filter((dimension) => dimension.outcome === "blocked");
  const nextUnblock = blocked.some((dimension) => dimension.id === "body-and-encoder-terms")
    ? "Owner decision on two terms, then a CUDA host. (1) Accept, or refuse, the Meta Llama 3 Community License "
      + "for meta-llama/Meta-Llama-3-8B-Instruct, which the pinned code's text encoder requires; this card may not "
      + "accept it. (2) Accept the NVIDIA Open Model License, which binds on use. (3) Provide a Linux or Windows "
      + "host with a CUDA GPU (>=3 GB VRAM with TEXT_ENCODER_DEVICE=cpu, or >=17 GB fully on GPU) under existing "
      + "authorization. Then screen Kimodo-SOMA-SEED-v1.1 first, since it is the open-training-data variant."
    : `Resolve ${blocking.map((dimension) => dimension.id).join(", ")} against first-party sources before rescreening.`;

  return {
    candidate: SCREENED_CANDIDATE,
    verdict: "held",
    dimensions,
    holdReasons,
    nextUnblock,
    refusals: [],
  };
}
