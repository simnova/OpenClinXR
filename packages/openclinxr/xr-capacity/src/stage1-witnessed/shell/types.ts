import type { Stage1Metadata } from '../../stage1/shell/types.js';
import type { Stage1Mode, Stage1Slot } from '../../stage1/grading/types.js';
import type { WitnessedStage1Release } from '../grading/types.js';
export interface WitnessedStage1Metadata extends Stage1Metadata { witnessWorkletSha256: string; witnessWorkletFile: string }
export interface WitnessedStage1Configuration { mode: Stage1Mode; slot: Stage1Slot; release: WitnessedStage1Release | null }
export interface MediaAdmission { accepted: boolean; mode: Stage1Mode; readyAt: number | null; reason: string | null; audioConfigHash: string | null }
