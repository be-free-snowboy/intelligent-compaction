import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            '@intelligent-compact/core': fileURLToPath(
                new URL('./packages/core/src/index.ts', import.meta.url)
            ),
        },
    },
    test: {
        root: 'packages',
        exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**'],
        coverage: {
            provider: 'v8',
            reporter: ['html', 'text'],
            thresholds: {
                statements: 75,
                branches: 55,
                functions: 80,
                lines: 77,
            },
        },
    },
})
