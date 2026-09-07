import type { ReadableVrTextPanelEvidence } from "@openclinxr/xr-runtime-state";
import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from "three";
import type { ReadableVrTextPanel, SceneCueClinicalPanelContext } from "./types.js";

export function createClinicalPanel(ctx: SceneCueClinicalPanelContext): ReadableVrTextPanel {
  const panel = createReadableVrTextPanel(ctx, {
    name: ctx.clinicalPanelObjectName,
    title: "Simulated EHR",
    lines: ctx.clinicalPanelLines(),
    widthMeters: 2.3,
    heightMeters: 1.15,
    background: "#fff8e5",
    accent: "#7d4f28",
  });
  panel.mesh.position.set(-1.55, 2.62, -1.42);
  panel.mesh.rotation.y = 0.34;
  return panel;
}

export function clinicalPanelLinesForBundle(input: { chiefConcern: string; initialVitals: string; interruption: string; title: string; bundleScenarioId: string; selectedScenarioId: string; selectedScenarioMatchesBundle: boolean; stationContextTitle: string | undefined; actorRoster: string; equipmentIds: string; dialogueTurns: string; roomProps: string }): string[] {
  return [
    `Chief concern: ${input.chiefConcern}`,
    `Vitals/context: ${input.initialVitals}`,
    `Interruption: ${input.interruption}`,
    `Scenario: ${input.title}`,
    `Bundle scenario: ${input.bundleScenarioId}${!input.selectedScenarioMatchesBundle ? ` (selected ${input.selectedScenarioId} mismatch hidden)` : " (selected match)"}`,
    `Station context: ${input.stationContextTitle ?? "manifest stationContext missing"}`,
    `Actor roster: ${input.actorRoster}`,
    `Equipment IDs: ${input.equipmentIds}`,
    `Dialogue turns: ${input.dialogueTurns}`,
    `Room props: ${input.roomProps}`,
  ];
}

export function publishReadableVrTextPanelEvidence(ctx: SceneCueClinicalPanelContext, evidence: ReadableVrTextPanelEvidence): void {
  ctx.evidenceStore.set(evidence.name, evidence);
  window.__openClinXrTextPanelEvidence = {
    source: "window.__openClinXrTextPanelEvidence",
    panelCount: ctx.evidenceStore.size,
    panels: [...ctx.evidenceStore.values()].sort((left, right) => left.name.localeCompare(right.name)),
    limitations: ["metadata_only_requires_foreground_headset_confirmation"],
  };
}

export function createReadableVrTextPanel(ctx: SceneCueClinicalPanelContext, options: {
  name: string;
  title: string;
  lines: readonly string[];
  widthMeters: number;
  heightMeters: number;
  background: string;
  accent: string;
}): ReadableVrTextPanel {
  const panelCanvas = document.createElement("canvas");
  panelCanvas.width = 1280;
  panelCanvas.height = 640;
  const context = panelCanvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create VR text panel canvas context");
  }
  const panelContext = context;
  const texture = new CanvasTexture(panelCanvas);
  const panel = new Mesh(
    new PlaneGeometry(options.widthMeters, options.heightMeters),
    new MeshBasicMaterial({ map: texture, side: DoubleSide }),
  );
  panel.name = options.name;

  function update(lines: readonly string[]): void {
    panelContext.fillStyle = options.background;
    panelContext.fillRect(0, 0, panelCanvas.width, panelCanvas.height);
    panelContext.fillStyle = options.accent;
    panelContext.fillRect(0, 0, 22, panelCanvas.height);
    panelContext.fillStyle = "#172332";
    panelContext.font = "700 62px Arial";
    panelContext.fillText(options.title, 58, 92);
    panelContext.font = "38px Arial";
    let y = 162;
    for (const line of lines) {
      y = drawWrappedText(panelContext, line, 58, y, panelCanvas.width - 116, 50) + 14;
    }
    texture.needsUpdate = true;
    publishReadableVrTextPanelEvidence(ctx, ctx.buildTextPanelEvidence({
      name: options.name,
      title: options.title,
      lines,
      canvasPixels: { width: panelCanvas.width, height: panelCanvas.height },
      worldMeters: { width: options.widthMeters, height: options.heightMeters },
      updatedAtMs: performance.now(),
    }));
  }

  update(options.lines);
  return { mesh: panel, update };
}

export function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(" ");
  let line = "";
  let currentY = y;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (context.measureText(testLine).width > maxWidth && line) {
      context.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    context.fillText(line, x, currentY);
  }
  return currentY + lineHeight;
}
