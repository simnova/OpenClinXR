import {STAGE2_CONFIG} from '../grading/config.js';
import type {Stage2BinPage} from '../grading/server-contract.js';
export const STAGE2_MAX_STATS_PAGES=STAGE2_CONFIG.bins.maximumRowsPerSource+1;
/** Response-size ceilings are not a promise that every page contains the maximum16 rows. */
export function stage2PageProgress(cursor:number,page:Pick<Stage2BinPage,'afterSequence'|'nextAfterSequence'|'totalAvailableRows'>&{rows:readonly unknown[]}):'done'|'continue' {
 if(!Number.isSafeInteger(cursor)||cursor< -1||page.afterSequence!==cursor||!Number.isSafeInteger(page.nextAfterSequence)||page.nextAfterSequence!==cursor+page.rows.length||page.rows.length>STAGE2_CONFIG.bins.maximumStatsPageRows||!Number.isSafeInteger(page.totalAvailableRows)||page.totalAvailableRows<0||page.totalAvailableRows>STAGE2_CONFIG.bins.maximumRowsPerSource||page.nextAfterSequence>=page.totalAvailableRows)throw Error('stats page progress/units');
 if(page.nextAfterSequence===page.totalAvailableRows-1)return 'done';
 if(page.nextAfterSequence<=cursor)throw Error('stats page did not progress');
 return 'continue';
}
