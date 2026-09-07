/**
 * Validator-only module: every export is a validator (names starting with
 * parse / validate / assert / is / clamped). No formatters or other functions.
 *
 * The implementation already existed in @openclinxr/ui-shared as
 * clampedScoreFromWorkbenchInput; it is re-exported rather than redefined.
 */

import { clampedScoreFromWorkbenchInput } from "@openclinxr/ui-shared";

export const clampedScoreFromInput = clampedScoreFromWorkbenchInput;
