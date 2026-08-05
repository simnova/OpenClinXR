import { describe, expect, it } from 'vitest';
import { formatLabel } from './index.ts';

describe('formatLabel', () => {
	it('title-cases underscore ids', () => {
		expect(formatLabel('peds_asthma_v1')).toBe('Peds Asthma V1');
	});

	it('handles empty segments', () => {
		expect(formatLabel('a__b')).toBe('A B');
	});
});
