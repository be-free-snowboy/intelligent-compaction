import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            '~': fileURLToPath(new URL('./packages/ic/src', import.meta.url)),
        },
    },
    test: {
        root: 'packages',
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
