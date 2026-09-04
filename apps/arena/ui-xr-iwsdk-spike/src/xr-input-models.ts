import { BufferGeometry, Line, LineBasicMaterial, type Scene, Vector3, type WebGLRenderer } from "three";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import type { RadialPulseContactMode } from "./radial-pulse-state.js";
import { iwsdkSidecarPrimitiveHandModelProfile } from "./sidecar-state.js";

export function addControllerAffordances(renderer: WebGLRenderer, scene: Scene, input: {
  onContactStart(mode: Exclude<RadialPulseContactMode, "none">): void;
  onContactEnd(): void;
}): void {
  const controllerModelFactory = new XRControllerModelFactory();
  const gripNames = [
    "openclinxr.ed-chest-pain.controller-grip-left",
    "openclinxr.ed-chest-pain.controller-grip-right",
  ];
  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index);
    controller.name = `openclinxr.ed-chest-pain.controller-${index + 1}`;
    controller.addEventListener("selectstart", (event) => {
      const inputSource = event.data as { hand?: unknown };
      input.onContactStart(inputSource.hand ? "two_finger" : "controller_proxy");
    });
    controller.addEventListener("selectend", input.onContactEnd);
    const ray = new Line(
      new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, -3)]),
      new LineBasicMaterial({ color: 0x8bd8bf }),
    );
    ray.name = `openclinxr.ed-chest-pain.controller-ray-${index + 1}`;
    controller.add(ray);
    scene.add(controller);
    const controllerGrip = renderer.xr.getControllerGrip(index);
    controllerGrip.name = gripNames[index] ?? `openclinxr.ed-chest-pain.controller-grip-${index + 1}`;
    controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip));
    scene.add(controllerGrip);
  }
}

export function addHandModels(renderer: WebGLRenderer, scene: Scene): void {
  const handModelFactory = new XRHandModelFactory();
  for (let index = 0; index < 2; index += 1) {
    const hand = renderer.xr.getHand(index);
    hand.name = `openclinxr.ed-chest-pain.hand-${index + 1}`;
    const handModel = handModelFactory.createHandModel(hand, iwsdkSidecarPrimitiveHandModelProfile);
    handModel.name = `openclinxr.ed-chest-pain.hand-model-${index + 1}`;
    hand.add(handModel);
    scene.add(hand);
  }
}
