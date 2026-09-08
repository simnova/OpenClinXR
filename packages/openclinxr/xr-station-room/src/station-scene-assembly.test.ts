import { describe, expect, it } from "vitest";
import { assembleStationScene } from "./station-scene-assembly.js";

/**
 * The point of the typestate shape is that an out-of-order call does not COMPILE. A runtime
 * test cannot observe that, so the type-level cases are pinned with @ts-expect-error: each one
 * fails the build if the narrowing is ever loosened to `: this`, which is exactly the
 * regression that made openclinxr's own api builder decorative.
 *
 * The runtime clauses cover the dynamic path, where a caller reached a stage through `unknown`.
 */
describe("station scene assembly is staged", () => {
  const scene = { name: "scene" };

  it("(1) runs every stage in order and hands each one what ran before it", () => {
    const seen: string[] = [];
    const assembly = assembleStationScene(scene)
      .room((sceneArg) => {
        seen.push("room");
        expect(sceneArg).toBe(scene);
        return { shell: "shell" };
      })
      .fixtures((_s, room) => {
        seen.push("fixtures");
        expect(room.shell).toBe("shell");
        return { equipment: 2 };
      })
      .actors((_s, room, fixtures) => {
        seen.push("actors");
        expect(room.shell).toBe("shell");
        expect(fixtures.equipment).toBe(2);
        return { patient: "p", nurse: "n" };
      })
      .panels((_s, _room, _fixtures, actors) => {
        seen.push("panels");
        expect(actors.patient).toBe("p");
        return { clinical: true };
      })
      .interaction((_s, _room, _fixtures, actors, panels) => {
        seen.push("interaction");
        expect(panels.clinical).toBe(true);
        return { pointerRay: actors.nurse };
      })
      .build();

    expect(seen).toEqual(["room", "fixtures", "actors", "panels", "interaction"]);
    expect(assembly.room.shell).toBe("shell");
    expect(assembly.interaction.pointerRay).toBe("n");
  });

  it("(2) POSITIVE CONTROL: build() before every stage throws and names the stage reached", () => {
    const partial = assembleStationScene(scene).room(() => ({})) as unknown as { build: () => unknown };
    expect(() => partial.build()).toThrow(/build\(\) needs every stage.*'fixtures'/su);
  });

  it("(3) a stage cannot run twice, even through an untyped reference", () => {
    const afterRoom = assembleStationScene(scene).room(() => ({})) as unknown as {
      room: (build: () => unknown) => unknown;
    };
    expect(() => afterRoom.room(() => ({}))).toThrow(/'room' is not available in stage 'fixtures'/u);
  });

  it("(4) a stage cannot be skipped, even through an untyped reference", () => {
    const afterRoom = assembleStationScene(scene).room(() => ({})) as unknown as {
      actors: (build: () => unknown) => unknown;
    };
    expect(() => afterRoom.actors(() => ({}))).toThrow(/'actors' is not available in stage 'fixtures'/u);
  });

  it("(5) the failure message states that order is behaviour, not preference", () => {
    const afterRoom = assembleStationScene(scene).room(() => ({})) as unknown as {
      room: (build: () => unknown) => unknown;
    };
    expect(() => afterRoom.room(() => ({}))).toThrow(/Construction order is behaviour here/u);
    expect(() => afterRoom.room(() => ({}))).toThrow(/room -> fixtures -> actors -> panels -> interaction -> built/u);
  });

  it("(6) TYPE-LEVEL: the stage types refuse an out-of-order call", () => {
    const afterRoom = assembleStationScene(scene).room(() => ({ shell: "shell" }));
    // @ts-expect-error room() is gone once it has run — the return type is the fixtures stage.
    afterRoom.room;
    // @ts-expect-error actors() is not reachable until fixtures() has run.
    afterRoom.actors;
    // @ts-expect-error build() is not reachable until every stage has run.
    afterRoom.build;
    expect(typeof afterRoom.fixtures).toBe("function");
  });
});
