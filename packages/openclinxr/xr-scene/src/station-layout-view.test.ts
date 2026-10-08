import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from "three";

import { installStationLayoutView } from "./index.js";

describe("station layout views", () => {
  it("places the overhead orthographic camera above tall retained fixtures", () => {
    const scene = new Scene();
    const room = new Group();
    room.name = "openclinxr.station-environment.infinigen-room";
    const floor = new Mesh(new BoxGeometry(6, 0.1, 4), new MeshBasicMaterial());
    floor.name = "floor";
    room.add(floor);
    scene.add(room);

    const fixture = new Mesh(new BoxGeometry(0.2, 3.6, 0.2), new MeshBasicMaterial());
    fixture.name = "privacy-curtain-track";
    fixture.position.set(0, 1.8, 0);
    scene.add(fixture);

    const reviewPanel = new Mesh(new BoxGeometry(0.2, 20, 0.2), new MeshBasicMaterial());
    reviewPanel.position.y = 10;
    reviewPanel.userData.openClinXrPortalInteriorReviewAffordance = true;
    scene.add(reviewPanel);

    const hiddenParent = new Group();
    hiddenParent.visible = false;
    const hiddenChild = new Mesh(new BoxGeometry(0.2, 24, 0.2), new MeshBasicMaterial());
    hiddenChild.position.y = 12;
    hiddenParent.add(hiddenChild);
    scene.add(hiddenParent);

    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
    try {
      installStationLayoutView(scene, { clientWidth: 1000, clientHeight: 800 } as HTMLCanvasElement, new PerspectiveCamera());
      window.__openClinXrSetLayoutView?.("overhead");
      const hold = window.__openClinXrDebugHoldCamera;
      expect(hold?.type).toBe("OrthographicCamera");
      expect(hold?.position.y).toBeGreaterThan(3.6);
      expect(hold?.position.y).toBeLessThan(10);
      expect(hold?.userData.openClinXrLayoutView).toMatchObject({ mode: "overhead" });
    } finally {
      Object.defineProperty(globalThis, "window", { value: previousWindow, configurable: true, writable: true });
    }
  });
});
