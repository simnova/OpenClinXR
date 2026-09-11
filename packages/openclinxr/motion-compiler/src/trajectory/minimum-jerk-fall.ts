import { minimumJerkSample } from "../trajectory.js";

/**
 * The minimum-jerk release fall on [0, 1]: 1 at release start, 0 at the settle, with zero
 * velocity at both ends. Contact release keys sample this between the window end and the
 * settle, so the fall eases out of the hold instead of stepping linearly to it.
 */
export function minimumJerkFall(progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return 1 - minimumJerkSample(p);
}