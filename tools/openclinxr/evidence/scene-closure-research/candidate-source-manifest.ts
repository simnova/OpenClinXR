/**
 * The pinned first-party source material for SC-10's A13 eligibility screening.
 *
 * Every entry is a URL that resolves an IMMUTABLE revision: a git commit sha for repository
 * blobs, a HuggingFace commit sha for checkpoint files. The card's counterweight list opens with
 * "wrong Kimodo project, mismatched revision", so a source that can silently change under us —
 * `main`, `refs/heads/...`, a tag — is refused by `manifestRevisionProblems` below rather than
 * screened.
 *
 * The two `.../api/models/...` and `.../api/datasets/...` entries are the exception and are marked
 * `mutableIndex: true`. A repository's gate status is not a versioned artifact; it is a fact about
 * right now, and the only honest way to carry it is a timestamped retrieval receipt. They may not
 * be used to establish terms — only availability.
 */

export type CandidateSourceKind =
  | "code-blob"
  | "code-licence"
  | "model-card"
  | "model-licence"
  | "checkpoint-config"
  | "availability-index";

export type CandidateSource = {
  sourceId: string;
  kind: CandidateSourceKind;
  /** First-party origin. Nothing here is a blog post or a third-party summary. */
  url: string;
  /** Where the retrieved bytes land under the evidence store's sc-10 prefix. */
  objectKey: string;
  /** True only for the HuggingFace index endpoints, which have no revision to pin. */
  mutableIndex: boolean;
  /** Why this source is consulted, in screening terms. */
  screens: string;
};

/** The code revision every `code-*` source below is pinned to. */
export const PINNED_CODE_COMMIT = "1aece8c124d73d255ceff5086d983b844c9f4e94";

/** The checkpoint revisions every `model-*`/`checkpoint-*` source below is pinned to. */
export const PINNED_CHECKPOINT_REVISIONS = {
  "Kimodo-SOMA-RP-v1.1": "6c9233af1180b8151e3c4703477104af5dce9dd5",
  "Kimodo-SOMA-SEED-v1.1": "aae3af194322c60d21bc44062b64c3fec912be50",
} as const;

const CODE = `https://raw.githubusercontent.com/nv-tlabs/kimodo/${PINNED_CODE_COMMIT}`;
const RP = `https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1.1/resolve/${PINNED_CHECKPOINT_REVISIONS["Kimodo-SOMA-RP-v1.1"]}`;
const SEED = `https://huggingface.co/nvidia/Kimodo-SOMA-SEED-v1.1/resolve/${PINNED_CHECKPOINT_REVISIONS["Kimodo-SOMA-SEED-v1.1"]}`;

export const CANDIDATE_SOURCES: readonly CandidateSource[] = [
  {
    sourceId: "kimodo-repo-readme",
    kind: "code-blob",
    url: `${CODE}/README.md`,
    objectKey: "sc-10/sources/kimodo-repo-readme.md",
    mutableIndex: false,
    screens: "project identity, per-variant licence table, VRAM and platform statements",
  },
  {
    sourceId: "kimodo-code-licence",
    kind: "code-licence",
    url: `${CODE}/LICENSE`,
    objectKey: "sc-10/sources/kimodo-code-licence.txt",
    mutableIndex: false,
    screens: "tool-code terms, which are NOT the model terms",
  },
  {
    sourceId: "kimodo-skeleton-definitions",
    kind: "code-blob",
    url: `${CODE}/kimodo/skeleton/definitions.py`,
    objectKey: "sc-10/sources/kimodo-skeleton-definitions.py",
    mutableIndex: false,
    screens: "the pinned skeleton mapping, read rather than inferred from weights",
  },
  {
    sourceId: "kimodo-skeleton-exports",
    kind: "code-blob",
    url: `${CODE}/kimodo/skeleton/__init__.py`,
    objectKey: "sc-10/sources/kimodo-skeleton-exports.py",
    mutableIndex: false,
    screens: "whether the checkpoint's skeleton class still exists at the pinned code revision",
  },
  {
    sourceId: "kimodo-pyproject",
    kind: "code-blob",
    url: `${CODE}/pyproject.toml`,
    objectKey: "sc-10/sources/kimodo-pyproject.toml",
    mutableIndex: false,
    screens: "the local dependency and installation path, including the SOMA body model",
  },
  {
    sourceId: "kimodo-text-encoder-readme",
    kind: "code-blob",
    url: `${CODE}/kimodo/model/llm2vec/README.md`,
    objectKey: "sc-10/sources/kimodo-text-encoder-readme.md",
    mutableIndex: false,
    screens: "which text encoder the pinned code requires — the encoder half of body/encoder terms",
  },
  {
    sourceId: "kimodo-text-encoder-wrapper",
    kind: "code-blob",
    url: `${CODE}/kimodo/model/llm2vec/llm2vec_wrapper.py`,
    objectKey: "sc-10/sources/kimodo-text-encoder-wrapper.py",
    mutableIndex: false,
    screens: "that the encoder is loaded as a base model plus PEFT adapter, so both need rights",
  },
  {
    sourceId: "text-encoder-adapter-config",
    kind: "code-blob",
    url:
      "https://huggingface.co/McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised/resolve/"
      + "baa8ebf04a1c2500e61288e7dad65e8ae42601a7/adapter_config.json",
    objectKey: "sc-10/sources/text-encoder-adapter-config.json",
    mutableIndex: false,
    screens: "the encoder adapter's declared base model, so the rights chain is parsed and not asserted",
  },
  {
    sourceId: "soma-rp-model-card",
    kind: "model-card",
    url: `${RP}/README.md`,
    objectKey: "sc-10/sources/soma-rp-model-card.md",
    mutableIndex: false,
    screens: "checkpoint output shape, supported OS and microarchitecture, training data name",
  },
  {
    sourceId: "soma-rp-model-licence",
    kind: "model-licence",
    url: `${RP}/LICENSE`,
    objectKey: "sc-10/sources/soma-rp-model-licence.txt",
    mutableIndex: false,
    screens: "model and OUTPUT terms, which the code licence does not govern",
  },
  {
    sourceId: "soma-rp-checkpoint-config",
    kind: "checkpoint-config",
    url: `${RP}/config.yaml`,
    objectKey: "sc-10/sources/soma-rp-checkpoint-config.yaml",
    mutableIndex: false,
    screens: "the checkpoint's OWN declared skeleton class — the decisive README/model-card tiebreak",
  },
  {
    sourceId: "soma-seed-model-card",
    kind: "model-card",
    url: `${SEED}/README.md`,
    objectKey: "sc-10/sources/soma-seed-model-card.md",
    mutableIndex: false,
    screens: "the open-training-data variant's terms and platform support",
  },
  {
    sourceId: "soma-seed-checkpoint-config",
    kind: "checkpoint-config",
    url: `${SEED}/config.yaml`,
    objectKey: "sc-10/sources/soma-seed-checkpoint-config.yaml",
    mutableIndex: false,
    screens: "that the second checkpoint declares the same skeleton as the first",
  },
  {
    sourceId: "hf-index-soma-rp",
    kind: "availability-index",
    url: "https://huggingface.co/api/models/nvidia/Kimodo-SOMA-RP-v1.1",
    objectKey: "sc-10/sources/hf-index-soma-rp.json",
    mutableIndex: true,
    screens: "whether the checkpoint is gated at retrieval time",
  },
  {
    sourceId: "hf-index-soma-seed",
    kind: "availability-index",
    url: "https://huggingface.co/api/models/nvidia/Kimodo-SOMA-SEED-v1.1",
    objectKey: "sc-10/sources/hf-index-soma-seed.json",
    mutableIndex: true,
    screens: "whether the second checkpoint is gated at retrieval time",
  },
  {
    sourceId: "hf-index-bones-seed-dataset",
    kind: "availability-index",
    url: "https://huggingface.co/api/datasets/bones-studio/seed",
    objectKey: "sc-10/sources/hf-index-bones-seed-dataset.json",
    mutableIndex: true,
    screens: "whether the open training dataset's own licence text is reachable first-party",
  },
  {
    sourceId: "hf-index-text-encoder-adapter",
    kind: "availability-index",
    url: "https://huggingface.co/api/models/McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised",
    objectKey: "sc-10/sources/hf-index-text-encoder-adapter.json",
    mutableIndex: true,
    screens: "the encoder adapter's gate status and licence",
  },
  {
    sourceId: "hf-index-text-encoder-base",
    kind: "availability-index",
    url: "https://huggingface.co/api/models/meta-llama/Meta-Llama-3-8B-Instruct",
    objectKey: "sc-10/sources/hf-index-text-encoder-base.json",
    mutableIndex: true,
    screens: "the encoder BASE model's gate status — the term this card may not accept",
  },
] as const;

const IMMUTABLE_REVISION = /\/(?:[0-9a-f]{40})\//u;

/**
 * Refuse a manifest whose non-index sources are not pinned to an immutable revision.
 *
 * This is the "mismatched revision" counterweight expressed as code rather than as care. A source
 * fetched from `main` screens whatever `main` happens to be, and a screening report that cites it
 * is unreproducible the moment upstream pushes.
 */
export function manifestRevisionProblems(
  sources: readonly CandidateSource[] = CANDIDATE_SOURCES,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.sourceId)) problems.push(`duplicate sourceId ${source.sourceId}`);
    seen.add(source.sourceId);
    if (source.mutableIndex) {
      if (source.kind !== "availability-index") {
        problems.push(`${source.sourceId} is mutable but claims kind ${source.kind}`);
      }
      continue;
    }
    if (!IMMUTABLE_REVISION.test(source.url)) {
      problems.push(`${source.sourceId} is not pinned to a 40-hex revision: ${source.url}`);
    }
  }
  return problems;
}
