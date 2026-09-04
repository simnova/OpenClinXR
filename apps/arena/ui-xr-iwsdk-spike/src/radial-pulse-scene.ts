import {
  CapsuleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  type Object3D,
} from "three";
import {
  createRadialPulseMachine,
  releaseRadialPulseContact,
  recordRadialPulsePatientAttachment,
  startRadialPulseApproach,
  startRadialPulseContact,
  updateRadialPulseContact,
  type RadialPulseContactMode,
  type RadialPulseEvidence,
} from "./radial-pulse-state.js";

declare global {
  interface Window {
    __openClinXrRadialPulseEvidence?: RadialPulseEvidence;
  }
}

export type RadialPulseSceneInteraction = {
  group: Group;
  beginContact(atMs: number, mode: Exclude<RadialPulseContactMode, "none">): void;
  endContact(atMs: number): void;
  update(now: number): void;
  attachToWrist(wrist: Object3D, assetUrl: string): void;
  recordPatientLoadFailure(assetUrl: string): void;
};

export function createRadialPulseSceneInteraction(input: {
  deterministicDemo: boolean;
  demoStartedAtMs: number;
  statusElement: HTMLElement;
}): RadialPulseSceneInteraction {
  let machine = createRadialPulseMachine(input.deterministicDemo);
  const target = createRadialPulseTarget();
  target.forearm.visible = !input.deterministicDemo;

  const publish = (): void => {
    window.__openClinXrRadialPulseEvidence = machine.evidence;
    const phaseLabel = machine.evidence.phase === "holding"
      ? `Pulse felt ${machine.evidence.pulseCount} | hold ${Math.round(machine.evidence.sustainedContactMs)} ms`
      : machine.evidence.phase.replaceAll("_", " ");
    input.statusElement.textContent = `Radial pulse: ${phaseLabel}`;
    input.statusElement.classList.toggle("active", machine.evidence.contactActive);
  };

  publish();
  return {
    group: target.group,
    beginContact(atMs, mode): void {
      if (!machine.evidence.contactActive) {
        machine = startRadialPulseApproach(machine, atMs);
        machine = startRadialPulseContact(machine, atMs, mode);
        publish();
      }
    },
    endContact(atMs): void {
      machine = releaseRadialPulseContact(machine, atMs);
      publish();
    },
    attachToWrist(wrist, assetUrl): void {
      target.forearm.visible = false;
      wrist.add(target.group);
      target.group.position.set(0, 0, 0);
      target.group.rotation.set(0, 0, 0);
      target.group.scale.setScalar(0.42);
      target.contactAssembly.position.set(0, 0, 0);
      target.fingerProxy.position.set(0, 0.16, 0.72);
      machine = recordRadialPulsePatientAttachment(machine, {
        assetUrl,
        loaded: true,
        wristBoneName: "wrist.R",
      });
      publish();
    },
    recordPatientLoadFailure(assetUrl): void {
      machine = recordRadialPulsePatientAttachment(machine, { assetUrl, loaded: false });
      publish();
    },
    update(now): void {
      const demoTimeMs = input.deterministicDemo ? (now - input.demoStartedAtMs) % 7_000 : -1;
      if (input.deterministicDemo) {
        if (demoTimeMs < 1_300 && machine.evidence.phase === "released") {
          const previousAttachment = machine.evidence;
          machine = createRadialPulseMachine(true);
          if (previousAttachment.patientAssetLoadStatus === "loaded"
            && previousAttachment.patientAssetUrl
            && previousAttachment.wristBoneName === "wrist.R") {
            machine = recordRadialPulsePatientAttachment(machine, {
              assetUrl: previousAttachment.patientAssetUrl,
              loaded: true,
              wristBoneName: "wrist.R",
            });
          }
        }
        if (demoTimeMs >= 300 && demoTimeMs < 1_300 && machine.evidence.phase === "ready") {
          machine = startRadialPulseApproach(machine, demoTimeMs);
        }
        if (demoTimeMs >= 1_300 && demoTimeMs < 5_300 && !machine.evidence.contactActive) {
          machine = startRadialPulseContact(machine, demoTimeMs, "two_finger");
        }
        if (demoTimeMs >= 5_300 && machine.evidence.contactActive) {
          machine = releaseRadialPulseContact(machine, demoTimeMs);
        }
      }

      machine = updateRadialPulseContact(machine, input.deterministicDemo ? demoTimeMs : now);
      const approaching = input.deterministicDemo ? Math.min(Math.max((demoTimeMs - 300) / 1_000, 0), 1) : 0;
      const releasing = input.deterministicDemo ? Math.min(Math.max((demoTimeMs - 5_300) / 900, 0), 1) : 0;
      const contactDistance = 0.17;
      const restDistance = 0.72;
      target.fingerProxy.visible = input.deterministicDemo;
      target.fingerProxy.position.z = machine.evidence.contactActive
        ? contactDistance
        : restDistance - approaching * (restDistance - contactDistance) + releasing * (restDistance - contactDistance);

      const pulseIntervalMs = 60_000 / machine.evidence.pulseBpm;
      const pulsePhase = machine.evidence.contactActive
        ? ((input.deterministicDemo ? demoTimeMs : now) % pulseIntervalMs) / pulseIntervalMs
        : 0;
      const pulseScale = 1 + Math.sin(pulsePhase * Math.PI) * 0.55;
      target.pulseRing.scale.setScalar(pulseScale);
      target.pulseRingMaterial.opacity = machine.evidence.contactActive ? 0.9 - pulsePhase * 0.55 : 0.22;
      target.wristMaterial.emissiveIntensity = machine.evidence.contactActive
        ? 1.4 + Math.sin(pulsePhase * Math.PI)
        : 0.7;
      publish();
    },
  };
}

function createRadialPulseTarget(): {
  group: Group;
  pulseRing: Mesh;
  pulseRingMaterial: MeshBasicMaterial;
  wristMaterial: MeshStandardMaterial;
  fingerProxy: Group;
  forearm: Mesh;
  contactAssembly: Group;
} {
  const group = new Group();
  group.name = "openclinxr.ed-chest-pain.patient-right-forearm-radial-target";
  group.position.set(0.02, 1.12, 0.58);
  group.rotation.z = Math.PI / 2;
  const forearm = new Mesh(
    new CapsuleGeometry(0.12, 0.72, 12, 24),
    new MeshStandardMaterial({ color: 0xcaa889, roughness: 0.7 }),
  );
  forearm.name = "openclinxr.ed-chest-pain.patient-right-forearm";
  const contactAssembly = new Group();
  contactAssembly.name = "openclinxr.ed-chest-pain.radial-pulse-contact-assembly";
  contactAssembly.position.y = 0.405;
  const wristMaterial = new MeshStandardMaterial({
    color: 0x26e0ad,
    emissive: 0x075b47,
    emissiveIntensity: 0.7,
    roughness: 0.35,
  });
  const wristTarget = new Mesh(new CylinderGeometry(0.145, 0.145, 0.09, 48), wristMaterial);
  wristTarget.name = "openclinxr.ed-chest-pain.radial-pulse-contact-target";
  const pulseRingMaterial = new MeshBasicMaterial({
    color: 0xffd35a,
    transparent: true,
    opacity: 0.35,
    side: DoubleSide,
  });
  const pulseRing = new Mesh(new CylinderGeometry(0.205, 0.205, 0.025, 48, 1, true), pulseRingMaterial);
  pulseRing.name = "openclinxr.ed-chest-pain.radial-pulse-feedback-ring";
  contactAssembly.add(wristTarget, pulseRing);
  const fingerProxy = new Group();
  fingerProxy.name = "openclinxr.ed-chest-pain.two-finger-contact-proxy";
  fingerProxy.rotation.z = -Math.PI / 2;
  const handMaterial = new MeshStandardMaterial({ color: 0x70b7e6, emissive: 0x08273c, roughness: 0.42 });
  const padMaterial = new MeshStandardMaterial({ color: 0xffcf9f, emissive: 0x4a1d0b, roughness: 0.48 });
  const palm = new Mesh(new SphereGeometry(0.18, 24, 18), handMaterial);
  palm.name = "openclinxr.ed-chest-pain.operator-hand-palm";
  palm.position.set(0, -0.06, 0.47);
  palm.scale.set(0.86, 1.16, 0.52);
  palm.rotation.x = -0.12;
  const cuff = new Mesh(new CylinderGeometry(0.085, 0.11, 0.14, 24), handMaterial);
  cuff.name = "openclinxr.ed-chest-pain.operator-hand-cuff";
  cuff.position.set(0, -0.25, 0.54);
  const thumb = new Mesh(new CapsuleGeometry(0.045, 0.16, 8, 16), handMaterial);
  thumb.name = "openclinxr.ed-chest-pain.operator-hand-thumb";
  thumb.position.set(-0.18, 0.02, 0.29);
  thumb.rotation.z = -0.8;
  fingerProxy.add(palm, cuff, thumb);
  for (const offset of [-0.085, 0.085]) {
    const finger = new Mesh(
      new CapsuleGeometry(0.045, 0.36, 10, 20),
      handMaterial,
    );
    finger.name = "openclinxr.ed-chest-pain.operator-hand-extended-finger";
    finger.position.x = offset;
    finger.position.z = 0.2;
    finger.rotation.x = Math.PI / 2;
    const pad = new Mesh(new SphereGeometry(0.062, 20, 14), padMaterial);
    pad.name = "openclinxr.ed-chest-pain.operator-hand-finger-pad";
    pad.position.set(offset, 0.08, -0.14);
    pad.scale.set(1, 0.78, 0.58);
    fingerProxy.add(finger, pad);
  }
  fingerProxy.position.set(0, 0.56, 0.72);
  group.add(forearm, contactAssembly, fingerProxy);
  return { group, pulseRing, pulseRingMaterial, wristMaterial, fingerProxy, forearm, contactAssembly };
}
