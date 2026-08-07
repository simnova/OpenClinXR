/**
 * Primitive capsule actor mesh fallback (#81 extract from main.ts freeze).
 */

import {
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";

export function createPrimitiveActorMesh(color: number): Group {
  const group = new Group();
  const body = new Mesh(
    new CapsuleGeometry(0.22, 0.7, 8, 16),
    new MeshStandardMaterial({ color, roughness: 0.7 }),
  );
  body.position.y = 0.55;
  const head = new Mesh(
    new SphereGeometry(0.2, 24, 16),
    new MeshStandardMaterial({ color: 0xcaa889, roughness: 0.75 }),
  );
  head.position.y = 1.15;
  group.add(body, head);
  return group;
}
