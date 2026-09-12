import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

/** Bounded producer-owned closure inputs, never report-selected filesystem roots. */
export const REQUIRED_SOURCE_PATHS = [
  "tools/openclinxr/factory/scene-closure-case-source.ts",
  "packages/openclinxr/asset-registry/src/case-frozen-scene-plans.ts",
  "packages/openclinxr/asset-registry/src/runtime-bundles.ts",
  "packages/openclinxr/xr-humanoid-animation/src/case-owned-approach-runtime.ts",
  "packages/openclinxr/xr-humanoid-animation/src/case-owned-approach-runtime-mod.ts",
  "packages/openclinxr/xr-humanoid-animation/src/station-bedside-approach-mod.ts",
  "packages/openclinxr/asset-registry/src/bedside-approach-path-mod.ts",
  "packages/openclinxr/xr-humanoid-animation/src/station-bedside-approach.ts",
  "packages/openclinxr/asset-registry/src/bedside-approach-path.ts",
  "apps/ui-xr/src/main.ts",
  "packages/openclinxr/xr-station/src/station-environment.ts",
  "packages/openclinxr/xr-station/src/station-stretcher.ts",
  "packages/openclinxr/xr-station/src/station-equipment.ts",
  "packages/openclinxr/xr-station/src/station-architecture-fixtures.ts",
  "packages/openclinxr/xr-station/src/station-equipment-builders.ts",
  "packages/openclinxr/xr-station/src/station-equipment-families.ts",

  "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
] as const;
export const REQUIRED_MEASUREMENTS = [
  "recorderStartedAtMs",
  "activationAtMs",
  "arrivalAtMs",
  "stopAtMs",
  "supportContactCount",
  "skinnedJointCount",
  "arrivalDistanceMeters",
  "headingErrorRadians",
  "stopSpeedMetersPerSecond",
] as const;
export type SourceReader = {
  read(commit: string, relativePath: string): Buffer | Error;
  current(relativePath: string): Buffer | Error;
};
export type MediaDecoder = (
  absolutePath: string,
  expectedSha256: string,
) => { durationSeconds: number; frames: number } | Error;
export function canonicalSourcePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !value.includes("\0") &&
    !path.posix.isAbsolute(value) &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}
const digest = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
export function pinnedSourceReader(repoRoot: string): SourceReader {
  const root = realpathSync(repoRoot);
  return {
    read(commit, relativePath) {
      if (!/^[a-f0-9]{40}$/u.test(commit) || !canonicalSourcePath(relativePath))
        return new Error("invalid pinned source identity");
      try {
        return execFileSync(
          "git",
          ["-C", root, "show", `${commit}:${relativePath}`],
          { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
    },
    current(relativePath) {
      if (!canonicalSourcePath(relativePath))
        return new Error("noncanonical current source path");
      try {
        const resolved = realpathSync(path.resolve(root, relativePath));
        if (!resolved.startsWith(`${root}${path.sep}`))
          return new Error("source resolves outside repository");
        return readFileSync(resolved);
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
    },
  };
}
/** Decode every frame; metadata or a video/* declaration alone cannot satisfy this boundary. */
export const decodeRetainedVideo: MediaDecoder = (
  absolutePath,
  expectedSha256,
) => {
  try {
    const resolvedBefore = realpathSync(absolutePath);
    if (digest(readFileSync(resolvedBefore)) !== expectedSha256)
      return new Error("video changed before decoding");
    const execution = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_frames",
        "-show_entries",
        "frame=best_effort_timestamp_time,pkt_duration_time,duration_time:stream=nb_read_frames",
        "-of",
        "json",
        absolutePath,
      ],
      { encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
    );
    if (
      execution.error ||
      execution.status !== 0 ||
      execution.stderr.trim() !== ""
    )
      return new Error(
        `retained video decode failed: ${execution.error?.message ?? execution.stderr}`,
      );
    const parsed = JSON.parse(execution.stdout) as {
      streams?: Array<{ nb_read_frames?: string }>;
      frames?: Array<{
        best_effort_timestamp_time?: string;
        pkt_duration_time?: string;
        duration_time?: string;
      }>;
    };
    const decodedFrames = parsed.frames ?? [];
    let firstTimestamp = Number.POSITIVE_INFINITY,
      lastEnd = Number.NEGATIVE_INFINITY,
      previousTimestamp = Number.NEGATIVE_INFINITY;
    for (const frame of decodedFrames) {
      const timestamp = Number(frame.best_effort_timestamp_time);
      const frameDuration = Number(
        frame.duration_time ?? frame.pkt_duration_time,
      );
      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(frameDuration) ||
        frameDuration <= 0 ||
        timestamp < previousTimestamp
      )
        return new Error(
          "decoded video frame clock/duration is unavailable or nonmonotonic",
        );
      previousTimestamp = timestamp;
      firstTimestamp = Math.min(firstTimestamp, timestamp);
      lastEnd = Math.max(lastEnd, timestamp + frameDuration);
    }
    const durationSeconds = lastEnd - firstTimestamp;
    const frames = Number(parsed.streams?.[0]?.nb_read_frames);
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      !Number.isFinite(frames) ||
      frames <= 0 ||
      decodedFrames.length !== frames
    )
      return new Error("retained media has no decodable video frames");
    const fullDecode = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-xerror",
        "-err_detect",
        "explode",
        "-i",
        absolutePath,
        "-map",
        "0:v:0",
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 },
    );
    if (
      fullDecode.error ||
      fullDecode.status !== 0 ||
      fullDecode.stderr.trim() !== ""
    )
      return new Error(
        `retained full-stream video decode failed: ${fullDecode.error?.message ?? fullDecode.stderr}`,
      );
    if (
      realpathSync(absolutePath) !== resolvedBefore ||
      digest(readFileSync(resolvedBefore)) !== expectedSha256
    )
      return new Error("video changed during decoding");
    return { durationSeconds, frames };
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export type RetainedObject = {
  bytes: Buffer;
  absolutePath: string;
  sha256: string;
  runId: string;
  mediaType: string;
};
export type ClosureInspection = {
  sourceReader: SourceReader;
  decodeVideo: MediaDecoder;
};

/** An index is not authority: compare declared identities to pinned bytes and retained producer/reviewer receipts. */
export function inspectClosureEvidence(
  report: Record<string, unknown>,
  objects: Map<string, RetainedObject>,
  scopes: readonly string[],
  inspection?: ClosureInspection,
): string[] {
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(message);
  };
  if (!inspection)
    return [
      "source/media inspection unavailable; actual closure cannot be verified",
    ];
  const implementation = record(report["implementation"])
    ? report["implementation"]
    : {};
  const gradingCommit = String(implementation["productSourceCommit"]);
  if (!/^[a-f0-9]{40}$/u.test(gradingCommit))
    fail("grading source commit must be a full immutable commit id");
  const gradingInputs = Array.isArray(implementation["inputs"])
    ? implementation["inputs"]
    : [];
  const gradingHashes = new Map<string, string>();
  for (const input of gradingInputs) {
    if (!record(input)) {
      fail("malformed grading source input");
      continue;
    }
    const name = String(input["path"]);
    const changedFiles = Array.isArray(implementation["changedFiles"])
      ? implementation["changedFiles"]
      : [];
    const allowedChanged =
      changedFiles.includes(name) &&
      scopes.some((scope) => name === scope || name.startsWith(`${scope}/`));
    if (
      !canonicalSourcePath(name) ||
      (!(REQUIRED_SOURCE_PATHS as readonly string[]).includes(name) &&
        !allowedChanged)
    ) {
      fail(`unapproved source input ${name}`);
      continue;
    }
    if (gradingHashes.has(name)) fail(`duplicate grading source input ${name}`);
    const bytes = inspection.sourceReader.read(gradingCommit, name);
    if (bytes instanceof Error) {
      fail(`grading source input ${name}: ${bytes.message}`);
      continue;
    }
    const actual = digest(bytes);
    if (actual !== input["sha256"])
      fail(`grading source input ${name}: sha256 mismatch`);
    gradingHashes.set(name, actual);
  }
  for (const changed of Array.isArray(implementation["changedFiles"])
    ? implementation["changedFiles"]
    : [])
    if (!gradingHashes.has(String(changed)))
      fail(`changed file has no pinned hash ${String(changed)}`);
  const binding = report["recordingBinding"];
  if (!record(binding)) return [...problems, "missing recordingBinding"];
  const commit = String(binding["executionSourceCommit"]);
  if (!/^[a-f0-9]{40}$/u.test(commit))
    fail("execution source commit must be a full immutable commit id");
  const inputs = Array.isArray(binding["executionInputs"])
    ? binding["executionInputs"]
    : [];
  const hashes = new Map<string, string>();
  const sourceBytes = new Map<string, Buffer>();
  for (const input of inputs) {
    if (!record(input)) {
      fail("malformed execution source input");
      continue;
    }
    const name = String(input["path"]);
    if (
      !canonicalSourcePath(name) ||
      !(REQUIRED_SOURCE_PATHS as readonly string[]).includes(name)
    ) {
      fail(`unapproved execution source input ${name}`);
      continue;
    }
    if (hashes.has(name)) fail(`duplicate execution source input ${name}`);
    const bytes = inspection.sourceReader.read(commit, name);
    if (bytes instanceof Error) {
      fail(`execution source input ${name}: ${bytes.message}`);
      continue;
    }
    const actual = digest(bytes);
    if (actual !== input["sha256"])
      fail(`execution source input ${name}: sha256 mismatch`);
    hashes.set(name, actual);
    sourceBytes.set(name, bytes);
  }
  for (const required of REQUIRED_SOURCE_PATHS)
    if (!hashes.has(required))
      fail(`missing required execution source input ${required}`);
  if (
    binding["claimMode"] !== "historical" &&
    binding["claimMode"] !== "current-replay"
  )
    fail("recordingBinding claimMode must be explicit");
  if (binding["claimMode"] === "current-replay")
    for (const required of hashes.keys()) {
      const current = inspection.sourceReader.current(required);
      if (current instanceof Error || digest(current) !== hashes.get(required))
        fail(`current replay input changed or unavailable ${required}`);
    }
  const parseObject = (id: unknown): Record<string, unknown> | undefined => {
    const object = objects.get(String(id));
    if (!object) {
      fail(`missing retained receipt ${String(id)}`);
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(object.bytes.toString("utf8"));
      if (record(parsed)) return parsed;
    } catch {
      /* fail below */
    }
    fail(`retained receipt ${String(id)} is not JSON object`);
    return undefined;
  };
  const video = objects.get(String(binding["videoArtifactId"]));
  const traceObject = objects.get(String(binding["traceArtifactId"]));
  const trace = parseObject(binding["traceArtifactId"]);
  const receipt = parseObject(binding["runReceiptArtifactId"]);
  if (!video || !video.mediaType.startsWith("video/"))
    fail("required original video is absent");
  let decoded: ReturnType<MediaDecoder> | undefined;
  if (video) {
    decoded = inspection.decodeVideo(video.absolutePath, video.sha256);
    if (decoded instanceof Error)
      fail(`video decoding failed: ${decoded.message}`);
  }
  const runId = binding["runId"];
  if (
    typeof runId !== "string" ||
    runId.length === 0 ||
    video?.runId !== runId ||
    traceObject?.runId !== runId ||
    trace?.["runId"] !== runId ||
    receipt?.["runId"] !== runId
  )
    fail("video/trace/receipt run identity mismatch");
  if (
    receipt?.["sourceCommit"] !== commit ||
    receipt?.["videoSha256"] !== video?.sha256 ||
    receipt?.["traceSha256"] !== traceObject?.sha256
  )
    fail("producer receipt source/video/trace identity mismatch");
  if (!isDeepStrictEqual(receipt?.["inputs"], inputs))
    fail("producer receipt inputs differ from pinned execution inputs");
  if (!isDeepStrictEqual(trace?.["identities"], receipt?.["identities"]))
    fail("trace/producer selected identity mismatch");
  const identities = record(trace?.["identities"]) ? trace["identities"] : {};
  for (const field of [
    "caseId",
    "caseVersion",
    "bundleId",
    "bundleSha256",
    "acceptedPlanSha256",
    "patientActorId",
    "physicianActorId",
    "physicianClip",
    "rig",
    "solverSeed",
  ])
    if (identities[field] === undefined || identities[field] === "")
      fail(`selected identity ${field} missing`);
  if (
    identities["caseId"] !== "scene_closure_supine_bedside_v1" ||
    identities["patientActorId"] !== "patient_margaret_ellis_v1" ||
    identities["physicianActorId"] !== "senior_resident_ward_v1" ||
    identities["physicianClip"] !== "openclinxr_retarget_walk_formal_cc0" ||
    identities["rig"] !== "mpfb2_standard_137_joint"
  )
    fail("selected case/actor/clip/rig differs from frozen closure selection");
  const bundleObject = objects.get(String(binding["bundleArtifactId"]));
  const planObject = objects.get(String(binding["acceptedPlanArtifactId"]));
  const caseObject = objects.get(String(binding["caseArtifactId"]));
  const bundle = parseObject(binding["bundleArtifactId"]);
  const plan = parseObject(binding["acceptedPlanArtifactId"]);
  const persistedCase = parseObject(binding["caseArtifactId"]);
  if (
    !bundleObject ||
    bundleObject.sha256 !== identities["bundleSha256"] ||
    !planObject ||
    planObject.sha256 !== identities["acceptedPlanSha256"] ||
    !caseObject ||
    caseObject.sha256 !== identities["caseSha256"]
  )
    fail(
      "selected bundle/accepted-plan/case bytes do not match recording identities",
    );
  if (
    bundle?.["bundleId"] !== identities["bundleId"] ||
    bundle?.["scenarioId"] !== identities["caseId"] ||
    persistedCase?.["scenarioId"] !== identities["caseId"] ||
    persistedCase?.["version"] !== identities["caseVersion"] ||
    !record(plan?.["variation"]) ||
    plan["variation"]["seed"] !== identities["solverSeed"]
  )
    fail("parsed selected bundle/plan/case identities mismatch");
  try {
    const frozenSource = sourceBytes
      .get("packages/openclinxr/asset-registry/src/case-frozen-scene-plans.ts")
      ?.toString("utf8");
    const body = frozenSource?.match(
      /Object\.freeze\((\{[\s\S]*\})\s+as Record<string, DurableAcceptedScenePlanRecord>\);\s*$/u,
    )?.[1];
    if (!body)
      throw new Error(
        "pinned generated freeze is not the supported JSON-only producer shape",
      );
    const selected: unknown = JSON.parse(body);
    if (
      !record(selected) ||
      !isDeepStrictEqual(selected["scene_closure_supine_bedside_v1"], plan)
    )
      throw new Error("accepted plan differs from pinned producer freeze");
    if (
      !record(plan?.["case"]) ||
      plan["case"]["caseId"] !== identities["caseId"] ||
      plan["case"]["caseVersion"] !== identities["caseVersion"]
    )
      throw new Error("accepted plan case differs from recorded case");
    const instances = Array.isArray(plan?.["instances"])
      ? plan["instances"]
      : [];
    const supportRows = instances.filter(
      (entry) => record(entry) && entry["kind"] === "support",
    );
    const support = supportRows.find(
      (entry) =>
        record(entry) &&
        entry["instanceId"] === identities["supportInstanceId"] &&
        entry["contentId"] === identities["supportContentId"],
    );
    if (
      !record(support) ||
      !record(plan?.["case"]) ||
      plan["case"]["environmentId"] !== identities["environmentId"]
    )
      throw new Error(
        "recorded support/environment differs from accepted frozen plan",
      );
    const actorIds = [
      "patient_margaret_ellis_v1",
      "senior_resident_ward_v1",
      "ward_nurse_patel_v1",
      "daughter_lena_ellis_v1",
    ];
    const actors = Array.isArray(bundle?.["actors"]) ? bundle["actors"] : [];
    for (const actorId of actorIds) {
      const instance = instances.find(
        (entry) => record(entry) && entry["contentId"] === actorId,
      );
      if (
        !record(instance) ||
        instance["assetSha256"] !== hashes.get(String(instance["assetPath"]))
      )
        throw new Error(
          `selected accepted-plan actor bytes differ: ${actorId}`,
        );
      const actor = actors.find(
        (entry) => record(entry) && entry["actorId"] === actorId,
      );
      const model =
        record(actor) && record(actor["model"]) ? actor["model"] : undefined;
      const blob = record(model?.["blob"]) ? model["blob"] : undefined;
      if (
        !blob ||
        blob["blobName"] !==
          String(instance["assetPath"]).replace(
            /^apps\/ui-xr\/public\//u,
            "",
          ) ||
        (blob["contentHash"] !== undefined &&
          blob["contentHash"] !== instance["assetSha256"])
      )
        throw new Error(`selected bundle actor model differs: ${actorId}`);
    }
  } catch (error) {
    fail(`accepted selection provenance failed: ${String(error)}`);
  }
  const physicianPath =
    "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
  if (identities["physicianAssetSha256"] !== hashes.get(physicianPath))
    fail("physician asset digest differs from pinned selected GLB");
  const physicianBytes = sourceBytes.get(physicianPath);
  try {
    if (
      !physicianBytes ||
      physicianBytes.readUInt32LE(0) !== 0x46546c67 ||
      physicianBytes.readUInt32LE(4) !== 2 ||
      physicianBytes.readUInt32LE(16) !== 0x4e4f534a
    )
      throw new Error("selected physician is not GLB2");
    const gltf = JSON.parse(
      physicianBytes
        .subarray(20, 20 + physicianBytes.readUInt32LE(12))
        .toString("utf8"),
    ) as {
      skins?: Array<{ joints?: number[] }>;
      animations?: Array<{ name?: string }>;
    };
    if (
      !gltf.skins?.some((skin) => skin.joints?.length === 137) ||
      !gltf.animations?.some(
        (animation) => animation.name === identities["physicianClip"],
      )
    )
      throw new Error("selected physician GLB has no pinned skin/clip");
  } catch (error) {
    fail(`selected GLB identity inspection failed: ${String(error)}`);
  }
  if (
    trace?.["clock"] !== "video-relative-ms" ||
    trace?.["headingUnit"] !== "radians"
  )
    fail(
      "recording trace clock/unit must be explicit video-relative-ms and radians",
    );
  const measurements = record(trace?.["measurements"])
    ? trace["measurements"]
    : {};
  for (const field of REQUIRED_MEASUREMENTS)
    if (
      typeof measurements[field] !== "number" ||
      !Number.isFinite(measurements[field])
    )
      fail(`missing numeric recording measurement ${field}`);
  if (measurements["recorderStartedAtMs"] !== 0)
    fail("video-relative recording clock must start at zero");
  if (
    !(
      Number(measurements["recorderStartedAtMs"]) <
        Number(measurements["activationAtMs"]) &&
      Number(measurements["activationAtMs"]) <
        Number(measurements["arrivalAtMs"]) &&
      Number(measurements["arrivalAtMs"]) <= Number(measurements["stopAtMs"])
    )
  )
    fail("recording/activation/arrival/stop timestamps are not ordered");
  if (
    Number(measurements["supportContactCount"]) <= 0 ||
    Number(measurements["skinnedJointCount"]) <= 0
  )
    fail("recording has no measured support contacts or skinned joints");
  if (
    decoded &&
    !(decoded instanceof Error) &&
    (Number(measurements["stopAtMs"]) -
      Number(measurements["recorderStartedAtMs"])) /
      1000 >
      decoded.durationSeconds
  )
    fail("trace extends beyond decoded recording");
  if (
    Number(measurements["arrivalDistanceMeters"]) < 0 ||
    Number(measurements["arrivalDistanceMeters"]) > 0.05 ||
    Math.abs(Number(measurements["headingErrorRadians"])) > (10 * Math.PI) / 180
  )
    fail("measured arrival/heading exceeds frozen acceptance limits");
  const watch = parseObject(binding["watchReceiptArtifactId"]);
  const reviews = Array.isArray(report["reviews"]) ? report["reviews"] : [];
  if (
    !watch ||
    watch["runId"] !== runId ||
    watch["videoSha256"] !== video?.sha256 ||
    watch["sourceCommit"] !== commit ||
    !decoded ||
    decoded instanceof Error ||
    watch["decodedFrames"] !== decoded.frames ||
    typeof watch["watchedThroughSeconds"] !== "number" ||
    !Number.isFinite(watch["watchedThroughSeconds"]) ||
    watch["watchedThroughSeconds"] < decoded.durationSeconds ||
    !reviews.some(
      (review) =>
        record(review) &&
        review["reviewerId"] === watch["reviewerId"] &&
        review["distinctFromImplementer"] === true &&
        review["reviewedSourceCommit"] === commit &&
        Array.isArray(review["retrievedArtifactIds"]) &&
        review["retrievedArtifactIds"].includes(binding["videoArtifactId"]),
    )
  )
    fail(
      "independent retrieved/decoded/full-watch receipt missing or mismatched",
    );
  if (report["cardKey"] === "SC-08" || report["cardKey"] === "SC-09") {
    const edited = objects.get(String(binding["editedVideoArtifactId"]));
    const edit = parseObject(binding["editReceiptArtifactId"]);
    const editedWatch = parseObject(binding["editedWatchReceiptArtifactId"]);
    const editedDecoded = edited
      ? inspection.decodeVideo(edited.absolutePath, edited.sha256)
      : new Error("edited video absent");
    if (
      !edited ||
      !edited.mediaType.startsWith("video/") ||
      edited.runId !== runId ||
      editedDecoded instanceof Error ||
      edit?.["runId"] !== runId ||
      edit?.["sourceCommit"] !== commit ||
      edit?.["sourceVideoSha256"] !== video?.sha256 ||
      edit?.["editedVideoSha256"] !== edited.sha256
    )
      fail(
        "reviewed edit is not decodable or derived from the accepted source run",
      );
    const ranges = Array.isArray(edit?.["sourceRanges"])
      ? edit["sourceRanges"]
      : [];
    if (
      ranges.length === 0 ||
      ranges.some(
        (range) =>
          !record(range) ||
          typeof range["startSeconds"] !== "number" ||
          !Number.isFinite(range["startSeconds"]) ||
          typeof range["endSeconds"] !== "number" ||
          !Number.isFinite(range["endSeconds"]) ||
          range["startSeconds"] < 0 ||
          range["endSeconds"] <= range["startSeconds"] ||
          !decoded ||
          decoded instanceof Error ||
          range["endSeconds"] > decoded.durationSeconds,
      )
    )
      fail("edit ranges are absent or outside the decoded source");
    if (
      !editedWatch ||
      editedWatch["videoSha256"] !== edited?.sha256 ||
      editedWatch["runId"] !== runId ||
      editedWatch["sourceCommit"] !== commit ||
      editedDecoded instanceof Error ||
      editedWatch["decodedFrames"] !== editedDecoded.frames ||
      typeof editedWatch["watchedThroughSeconds"] !== "number" ||
      !Number.isFinite(editedWatch["watchedThroughSeconds"]) ||
      editedWatch["watchedThroughSeconds"] < editedDecoded.durationSeconds ||
      !reviews.some(
        (review) =>
          record(review) &&
          review["reviewerId"] === editedWatch["reviewerId"] &&
          review["distinctFromImplementer"] === true &&
          Array.isArray(review["retrievedArtifactIds"]) &&
          review["retrievedArtifactIds"].includes(
            binding["editedVideoArtifactId"],
          ),
      )
    )
      fail("independent edited-video retrieval/full-watch receipt missing");
  }
  return problems;
}
