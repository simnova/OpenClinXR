/**
 * Ground-truth dy gate for the mouth verifier (MADR 0061 verifier).
 *
 * Bias-aware projection gate moved with the evaluator: the capture's visible
 * crown set shifts through the lip aperture as teeth sit deeper (the
 * face-legal seat), while the model projects the full anatomical shell, so a
 * constant cy offset is visibility composition, not mistracking. Bounds come
 * from the objective package so the verifier and the solver share one
 * vocabulary [inv:R1][MADR 0060 d4, 0061 d2].
 */
import {
  DY_GATE_BIAS_PX,
  DY_GATE_DETRENDED_MEDIAN_PX,
  DY_GATE_MAX_PX,
} from "@openclinxr/station-mouth-objective";

/** Gate rule tag recorded on failure. */
export const DY_GATE_RULE = "mouth-solver-ground-truth-dy-gate";

/** Assert the bias-aware dy ground-truth gate. */
export function assertGroundTruthDyGate(
  dyBiasPx: number,
  dyDetrendedMedianPx: number,
  dyMaxPx: number,
): void {
  if (!(Math.abs(dyBiasPx) <= DY_GATE_BIAS_PX)) {
    throw new Error(
      `${DY_GATE_RULE}: dy bias ${dyBiasPx}px exceeds gate ${DY_GATE_BIAS_PX}px`,
    );
  }
  if (!(dyDetrendedMedianPx <= DY_GATE_DETRENDED_MEDIAN_PX)) {
    throw new Error(
      `${DY_GATE_RULE}: detrended median |dy| ${dyDetrendedMedianPx}px exceeds gate ${DY_GATE_DETRENDED_MEDIAN_PX}px`,
    );
  }
  if (!(dyMaxPx <= DY_GATE_MAX_PX)) {
    throw new Error(`${DY_GATE_RULE}: max |dy| ${dyMaxPx}px exceeds gate ${DY_GATE_MAX_PX}px`);
  }
}
