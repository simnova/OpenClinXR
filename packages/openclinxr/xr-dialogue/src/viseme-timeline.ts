/**
 * Public viseme timeline subpath: canonical phoneme-to-jaw mapping.
 *
 * Narrow re-export — only the symbol real consumers bind. The aperture table
 * stays internal; consumers derive fractions from this mapping.
 */
export { jawOpenRadiansForPhoneme } from "./viseme-timeline-drive.js";
