/* oxlint-disable no-console */
// Copies the engine-generated Claude Code declarations into the adapter.
// Source: an explicit path argument, or the file the engine lays beside the
// plugin when an interactive session loads it with --plugin-dir.
import { copyFile, readFile } from 'node:fs/promises'

const target = new URL(
    '../packages/claude-code/host-types/claude-code.d.ts',
    import.meta.url
)
const source =
    process.argv[2] ??
    new URL(
        '../packages/claude-code/.claude-plugin/types/claude-code/index.d.ts',
        import.meta.url
    ).pathname

const header = (await readFile(source, 'utf8')).split('\n', 1)[0]
if (!header.startsWith('// Written by Claude Code ')) {
    console.error(`Not an engine-generated declaration file: ${source}`)
    process.exit(1)
}
await copyFile(source, target)
console.log(`Synced host types (${header.slice(3)}) from ${source}`)
