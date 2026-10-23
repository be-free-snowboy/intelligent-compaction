import { defineConfig } from 'tsdown'

export default defineConfig({
    entry: {
        register: 'src/register.ts',
    },
    tsconfig: './tsconfig.build.json',
    format: ['esm', 'cjs'],
    deps: {
        alwaysBundle: [/^@intelligent-compact\/core/],
    },
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
