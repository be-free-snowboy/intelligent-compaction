import { defineConfig } from 'tsdown'

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: {
        generator: 'tsgo',
        tsconfig: './tsconfig.build.json',
    },
    fixedExtension: false,
    sourcemap: false,
    target: 'esnext',
    clean: false,
    outDir: 'dist',
})
