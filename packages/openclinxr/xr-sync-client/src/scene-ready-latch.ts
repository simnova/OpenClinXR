/** Arm the learner ready signal only after the UI-XR interior camera latch exists. */

interface ReadyHandle {
  sendReady(): void;
  leave(): Promise<void>;
}

/** Mutate one live handle so ready polling is cancelled on leave. */
export function armInteriorLatchReady(handle: ReadyHandle): void {
  let readyPoll: ReturnType<typeof setTimeout> | undefined;
  const sendWhenLatched = (): void => {
    const camera = (globalThis as { __openClinXrGazeCamera?: { userData?: { openClinXrInteriorPreviewCamera?: unknown } } }).__openClinXrGazeCamera;
    if ((camera?.userData?.openClinXrInteriorPreviewCamera ?? null) != null) {
      handle.sendReady();
      readyPoll = undefined;
      return;
    }
    readyPoll = setTimeout(sendWhenLatched, 16);
  };
  const leave = handle.leave;
  handle.leave = async () => {
    if (readyPoll !== undefined) clearTimeout(readyPoll);
    await leave();
  };
  sendWhenLatched();
}
