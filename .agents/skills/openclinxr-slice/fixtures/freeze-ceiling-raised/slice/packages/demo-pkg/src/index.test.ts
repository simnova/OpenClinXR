import { describe, expect, it } from 'vitest';
import { formatLabel } from './index.ts';

describe('formatLabel', () => {
	it('replaces underscores', () => {
		expect(formatLabel('a_b')).toBe('a b');
	});
});
