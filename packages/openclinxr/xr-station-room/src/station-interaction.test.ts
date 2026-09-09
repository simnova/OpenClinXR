import { Mesh, PerspectiveCamera } from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { wireStationPointerInteraction } from "./index.js";
import type { StationClinicalTouchSource } from "./index.js";

/**
 * The desktop pointer ray is the path a HEADLESS capture drives, so a defect here is invisible in
 * the headset and silently produces captures with no clinical touch in them. Extracted from
 * apps/ui-xr/src/main.ts in the createStationScene builder wiring.
 */
type PointerListener = (event: { clientX: number; clientY: number }) => void;

function fakeRenderer(rect: { left: number; top: number; width: number; height: number }) {
  const listeners: PointerListener[] = [];
  return {
    listeners,
    domElement: {
      addEventListener: (_type: string, listener: PointerListener) => listeners.push(listener),
      getBoundingClientRect: () => rect,
    },
  };
}

describe("station pointer interaction", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });

  const touches: { ndcX: number; ndcY: number; source: StationClinicalTouchSource }[] = [];
  const wire = (rect: { left: number; top: number; width: number; height: number }) => {
    touches.length = 0;
    const renderer = fakeRenderer(rect);
    const camera = new PerspectiveCamera();
    wireStationPointerInteraction({
      renderer: renderer as never,
      camera,
      tryClinicalTouchFromNdc: (_camera, ndcX, ndcY, source) => {
        touches.push({ ndcX, ndcY, source });
      },
      clinicalTouchRegionTargets: () => [],
    });
    return renderer;
  };

  it("(1) a pointerdown maps client pixels to NDC with the y axis inverted", () => {
    const renderer = wire({ left: 0, top: 0, width: 200, height: 100 });
    renderer.listeners[0]?.({ clientX: 150, clientY: 25 });
    // Right of centre and above it: +0.5 in x, +0.5 in y (screen y is inverted for NDC).
    expect(touches).toEqual([{ ndcX: 0.5, ndcY: 0.5, source: "dom_click_trace_button" }]);
  });

  it("(2) COUNTERWEIGHT: a zero-size canvas fires nothing, so no touch is attributed to a hidden view", () => {
    // Without this guard the NDC maths divides by zero and every headless click before layout
    // reports a touch at NaN, which reads downstream as a real learner action.
    const renderer = wire({ left: 0, top: 0, width: 0, height: 0 });
    renderer.listeners[0]?.({ clientX: 10, clientY: 10 });
    expect(touches).toEqual([]);
  });

  it("(3) the projection hook returns null for a region id that is not mounted", () => {
    wire({ left: 0, top: 0, width: 200, height: 100 });
    const project = (globalThis as { window: { __openClinXrProjectTouchRegionToScreen?: (id: string) => unknown } })
      .window.__openClinXrProjectTouchRegionToScreen;
    expect(project?.("no-such-region")).toBeNull();
  });

  it("(4) the region list is read at CALL time, not at wiring time", () => {
    // The app pushes touch regions after this wiring runs. A captured value would leave the hook
    // permanently empty and every headless clinical-touch gate would report no regions.
    const regions: Mesh[] = [];
    const renderer = fakeRenderer({ left: 0, top: 0, width: 200, height: 100 });
    wireStationPointerInteraction({
      renderer: renderer as never,
      camera: new PerspectiveCamera(),
      tryClinicalTouchFromNdc: () => undefined,
      clinicalTouchRegionTargets: () => regions,
    });
    const mesh = new Mesh();
    mesh.userData["openClinXrTouchRegionId"] = "chest";
    regions.push(mesh);
    const project = (globalThis as { window: { __openClinXrProjectTouchRegionToScreen?: (id: string) => unknown } })
      .window.__openClinXrProjectTouchRegionToScreen;
    expect(project?.("chest")).not.toBeNull();
  });
});
