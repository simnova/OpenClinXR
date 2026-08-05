import { defineConfig } from 'vitest/config';

export default defineConfig({
	root: '.agents/skills/openclinxr-slice/evaluator',
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		passWithNoTests: false,
	},
});
