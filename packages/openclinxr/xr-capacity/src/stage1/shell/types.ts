import type { Stage0Metadata } from '../../stage0/types.js';
import type { Stage1Mode, Stage1Release, Stage1Slot } from '../grading/types.js';
export interface Stage1Metadata extends Stage0Metadata { workletSha256: string; audioConfigSha256: string; workletFile: string; inputClass: 'actual-microphone' | 'synthetic-host' }
export interface Stage1Configuration { mode: Stage1Mode; slot: Stage1Slot; release: Stage1Release | null }
export interface MediaAdmission { accepted: boolean; mode: Stage1Mode; readyAt: number | null; reason: string | null; audioConfigHash: string | null }
