/**
 * Staged station-scene assembly — a typestate builder, adapted from CellixJs `Cellix`
 * (apps/api/src/cellix.ts in the reference clone).
 *
 * WHY THIS SHAPE AND NOT A CHAINABLE SETTER BAG: scene-graph construction order IS behaviour
 * here, and prose has repeatedly failed to protect it. "Do not reorder construction steps"
 * appears in five worker briefs; two slices were discarded partly over ordering; and the
 * standing hazard in the actor stage is that the four slots look like duplication while the
 * family slot must stamp its identity BEFORE framing reads it (#591) and additional_cast must
 * hide unconditionally where the others test the named subject (#315). No source-text fence
 * can see a reordering — `static-assets.test.ts` concatenates main.ts with every xr-* package,
 * so moved and reordered code still matches every string.
 *
 * CellixJs solves the same class by returning a DIFFERENT INTERFACE from each step
 * (ContextBuilder -> ApplicationServicesInitializer -> AzureFunctionHandlerRegistry -> startUp)
 * rather than `this`, so an out-of-order call does not compile. Its runtime
 * `Phase = 'infrastructure' | 'context' | 'app-services' | 'handlers' | 'started'` with
 * `ensurePhase` is the second net for dynamic callers.
 *
 * MEASURED 2026-09-08, and it is why this is worth the extra interfaces: openclinxr's own
 * `OpenClinXrApiStartupBuilder` (apps/api/src/api-bootstrap.ts) copied Cellix's five method
 * NAMES and returned `: this` from every one, so `startUp()` before `setContext()` compiles
 * and silently uses the default factory, and a second `setContext` silently wins. The fluent
 * style without the narrowing type is decoration.
 *
 * WHAT EACH STAGE RECEIVES is the accumulated result of the stages before it and nothing else.
 * The fixtures stage cannot read actors because actors have not run; that is the ordering
 * constraint expressed as data availability rather than as a comment.
 */

/** Stages in construction order. `started` is terminal. */
export type StationSceneStage = "room" | "fixtures" | "actors" | "panels" | "interaction" | "built";

const STAGE_ORDER: readonly StationSceneStage[] = ["room", "fixtures", "actors", "panels", "interaction", "built"];

export type StationSceneAssembly<Room, Fixtures, Actors, Panels, Interaction> = {
  room: Room;
  fixtures: Fixtures;
  actors: Actors;
  panels: Panels;
  interaction: Interaction;
};

export interface StationSceneRoomStage<Scene> {
  /** The room shell and its environment assets. Everything else mounts into what this returns. */
  room<Room>(build: (scene: Scene) => Room): StationSceneFixturesStage<Scene, Room>;
}

export interface StationSceneFixturesStage<Scene, Room> {
  /**
   * Equipment and room props. Runs AFTER the shell because the XOR exclusive-mount rule
   * (#140/#185) skips builder-backed roomProps already claimed by the equipment channel, and
   * #186 suppresses props whose role a shell fixture already owns — both need the shell.
   */
  fixtures<Fixtures>(build: (scene: Scene, room: Room) => Fixtures): StationSceneActorsStage<Scene, Room, Fixtures>;
}

export interface StationSceneActorsStage<Scene, Room, Fixtures> {
  /**
   * The four actor slots. Runs AFTER fixtures so declared-equipment evidence is stamped before
   * an actor can claim a mount, and BEFORE panels so a panel can read a staged actor.
   */
  actors<Actors>(build: (scene: Scene, room: Room, fixtures: Fixtures) => Actors): StationScenePanelsStage<Scene, Room, Fixtures, Actors>;
}

export interface StationScenePanelsStage<Scene, Room, Fixtures, Actors> {
  /** In-scene VR panels and the conversation HUD, which read staged actors. */
  panels<Panels>(build: (scene: Scene, room: Room, fixtures: Fixtures, actors: Actors) => Panels): StationSceneInteractionStage<Scene, Room, Fixtures, Actors, Panels>;
}

export interface StationSceneInteractionStage<Scene, Room, Fixtures, Actors, Panels> {
  /** Controller affordances, the desktop pointer ray and the headless touch hooks. Last, because they hit-test everything above. */
  interaction<Interaction>(build: (scene: Scene, room: Room, fixtures: Fixtures, actors: Actors, panels: Panels) => Interaction): StationSceneBuiltStage<Room, Fixtures, Actors, Panels, Interaction>;
}

export interface StationSceneBuiltStage<Room, Fixtures, Actors, Panels, Interaction> {
  /** The assembled scene. The frame loop and XR session stay in the app: that lifetime is the composition root's job. */
  build(): StationSceneAssembly<Room, Fixtures, Actors, Panels, Interaction>;
}

class StationSceneBuilder<Scene> {
  private stage: StationSceneStage = "room";
  private readonly results: Record<string, unknown> = {};

  constructor(private readonly scene: Scene) {}

  /** The runtime net. The types stop a static caller; this stops a dynamic one and names the stage. */
  private advance(from: StationSceneStage, to: StationSceneStage): void {
    if (this.stage !== from) {
      throw new Error(
        `station scene: '${from}' is not available in stage '${this.stage}'. Construction order is behaviour here — `
        + `stages run ${STAGE_ORDER.join(" -> ")}, and a stage may run exactly once.`,
      );
    }
    this.stage = to;
  }

  room<Room>(build: (scene: Scene) => Room): StationSceneFixturesStage<Scene, Room> {
    this.advance("room", "fixtures");
    this.results["room"] = build(this.scene);
    return this as unknown as StationSceneFixturesStage<Scene, Room>;
  }

  fixtures<Fixtures>(build: (scene: Scene, room: never) => Fixtures): unknown {
    this.advance("fixtures", "actors");
    this.results["fixtures"] = build(this.scene, this.results["room"] as never);
    return this;
  }

  actors<Actors>(build: (scene: Scene, room: never, fixtures: never) => Actors): unknown {
    this.advance("actors", "panels");
    this.results["actors"] = build(this.scene, this.results["room"] as never, this.results["fixtures"] as never);
    return this;
  }

  panels<Panels>(build: (scene: Scene, room: never, fixtures: never, actors: never) => Panels): unknown {
    this.advance("panels", "interaction");
    this.results["panels"] = build(
      this.scene,
      this.results["room"] as never,
      this.results["fixtures"] as never,
      this.results["actors"] as never,
    );
    return this;
  }

  interaction<Interaction>(build: (scene: Scene, room: never, fixtures: never, actors: never, panels: never) => Interaction): unknown {
    this.advance("interaction", "built");
    this.results["interaction"] = build(
      this.scene,
      this.results["room"] as never,
      this.results["fixtures"] as never,
      this.results["actors"] as never,
      this.results["panels"] as never,
    );
    return this;
  }

  build(): unknown {
    if (this.stage !== "built") {
      throw new Error(
        `station scene: build() needs every stage. Current stage '${this.stage}'; run ${STAGE_ORDER.join(" -> ")}.`,
      );
    }
    return { ...this.results };
  }
}

/**
 * Opens a staged assembly over `scene`. Each call returns the NEXT stage only, so an
 * out-of-order or repeated call is a type error before it is a runtime one.
 */
export function assembleStationScene<Scene>(scene: Scene): StationSceneRoomStage<Scene> {
  return new StationSceneBuilder(scene) as unknown as StationSceneRoomStage<Scene>;
}
