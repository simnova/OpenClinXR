/** Node tools do not own the app dependency edge. Test-only typing delegates to its exact built public declaration; runtime resolves the app installed manifest in vitest.config.ts. */
declare module "@openclinxr/xr-dialogue/actor-audio-runtime" {
  export const createActorAudioRuntime: typeof import("../../../../packages/openclinxr/xr-dialogue/dist/actor-audio-runtime.js").createActorAudioRuntime;
}
