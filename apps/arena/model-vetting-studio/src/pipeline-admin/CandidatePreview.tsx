import type { PipelineCandidate } from "@openclinxr/model-vetting";
import { Alert, Segmented, Spin } from "antd";
import { useEffect, useRef, useState } from "react";
import {
  isFixedCameraView,
  renderCandidateCapture,
  renderDualCandidateCapture,
  type FixedCameraView,
} from "../candidate-capture.js";
import { pipelineCandidatesToStudioEvidence } from "./preview-bridge.js";

const FIXED_VIEWS: FixedCameraView[] = ["front", "three_quarter", "side"];

/** Single-candidate head-in-frame three.js preview. */
export function CandidatePreview(props: { candidate: PipelineCandidate }): React.ReactElement {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<FixedCameraView>("three_quarter");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    setStatus("loading");
    const evidence = pipelineCandidatesToStudioEvidence([props.candidate]);
    void renderCandidateCapture({ mount, evidence, candidateId: props.candidate.candidateId, view })
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      mount.replaceChildren();
    };
  }, [props.candidate, view]);

  return (
    <div>
      <Segmented
        options={FIXED_VIEWS.map((value) => ({ label: value.replaceAll("_", " "), value }))}
        value={view}
        onChange={(value) => {
          if (isFixedCameraView(String(value))) setView(value as FixedCameraView);
        }}
        aria-label="Preview camera view"
      />
      {status === "loading" ? <Spin style={{ display: "block", margin: "24px auto" }} /> : null}
      {status === "error" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          title="Preview unavailable"
          description={`${message} (GLB may only exist in the full asset-production checkout).`}
        />
      ) : null}
      <div
        ref={mountRef}
        data-testid="candidate-preview-mount"
        style={{ marginTop: 12, minHeight: 320, width: "100%" }}
      />
    </div>
  );
}

/** Two-candidate side-by-side three.js compare (cagematch). */
export function CandidateCompare(props: {
  left: PipelineCandidate;
  right: PipelineCandidate;
}): React.ReactElement {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    setStatus("loading");
    const evidence = pipelineCandidatesToStudioEvidence([props.left, props.right]);
    void renderDualCandidateCapture({
      mount,
      evidence,
      leftCandidateId: props.left.candidateId,
      rightCandidateId: props.right.candidateId,
      view: "three_quarter",
    })
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      mount.replaceChildren();
    };
  }, [props.left, props.right]);

  return (
    <div>
      {status === "loading" ? <Spin style={{ display: "block", margin: "24px auto" }} /> : null}
      {status === "error" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          title="Compare unavailable"
          description={`${message} (one or both GLBs may only exist in the full asset-production checkout).`}
        />
      ) : null}
      <div
        ref={mountRef}
        data-testid="candidate-compare-mount"
        style={{ marginTop: 12, minHeight: 360, width: "100%" }}
      />
    </div>
  );
}
