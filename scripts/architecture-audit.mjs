/* oxlint-disable no-console */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const root = new URL('../', import.meta.url)
const rootPath = root.pathname
const manifest = JSON.parse(
    await readFile(
        new URL(
            '../packages/claude-code/.claude-plugin/plugin.json',
            import.meta.url
        ),
        'utf8'
    )
)
const registry = JSON.parse(manifest.userConfig.policy_registry_json.default)
const exampleRegistry = JSON.parse(
    await readFile(
        new URL(
            '../packages/claude-code/config/policy-registry.example.json',
            import.meta.url
        ),
        'utf8'
    )
)

const coreFiles = await collect(join(rootPath, 'packages/core/src'))
const adapterFiles = await collect(join(rootPath, 'packages/claude-code/src'))
const runtimeFiles = [...coreFiles, ...adapterFiles].filter(
    (file) => !file.includes('/__tests__/')
)
const source = new Map(
    await Promise.all(
        runtimeFiles.map(async (file) => [
            relative(rootPath, file),
            await readFile(file, 'utf8'),
        ])
    )
)
const violations = []

if (JSON.stringify(registry) !== JSON.stringify(exampleRegistry)) {
    violations.push(
        'packages/claude-code/config/policy-registry.example.json does not match the manifest default registry'
    )
}

for (const [file, text] of source) {
    // Claude host capability access terminates in the adapter composition root.
    if (
        file !== 'packages/claude-code/src/register.ts' &&
        text.includes('$.')
    ) {
        violations.push(
            `${file}: direct Claude host capability access ($.) outside the composition root`
        )
    }

    // The core must remain independent of every host adapter.
    if (file.startsWith('packages/core/')) {
        if (
            /from\s+['"](?:claude-code|@intelligent-compact\/claude-code)['"]/.test(
                text
            )
        ) {
            violations.push(`${file}: core imports a Claude Code host adapter`)
        }
        if (/from\s+['"][^'"]*\/?claude-code\//.test(text)) {
            violations.push(`${file}: core imports a host-specific module`)
        }
    }
}

// Policy threshold defaults are deployment data. Runtime code must not duplicate
// a substantial token-valued threshold from the shipped registry.
const tokenDefaults = new Set()
for (const policy of registry.policies ?? []) {
    for (const spec of [
        policy.thresholds?.arm,
        policy.thresholds?.mandatory,
        policy.thresholds?.hostHeadroom,
        policy.probe?.minGap,
        policy.probe?.maxGap,
        policy.compaction?.minProgress,
    ]) {
        if (
            spec?.unit === 'tokens' &&
            Number.isInteger(spec.value) &&
            spec.value >= 1000
        ) {
            tokenDefaults.add(String(spec.value))
        }
    }
}
for (const [file, text] of source) {
    for (const value of tokenDefaults) {
        const literal = new RegExp(`(^|[^0-9])${escapeRegex(value)}([^0-9]|$)`)
        if (literal.test(text)) {
            violations.push(
                `${file}: duplicates configured token threshold ${value}`
            )
        }
    }
}

// Runtime code must remain engine-native: no Node/DOM dependencies.
const forbidden = [
    /from\s+['"]node:/,
    /from\s+['"](?:fs|path|os|child_process|http|https)['"]/,
    /\bprocess\./,
    /\bdocument\./,
    /\bwindow\./,
]
for (const [file, text] of source) {
    if (forbidden.some((pattern) => pattern.test(text))) {
        violations.push(`${file}: forbidden Node/DOM runtime dependency`)
    }
}

if (violations.length) {
    console.error('Architecture audit failed:')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exitCode = 1
} else {
    console.log(
        `Architecture audit passed (${source.size} runtime TypeScript files).`
    )
    console.log(
        `Policy defaults remain registry data; ${tokenDefaults.size} token threshold values audited.`
    )
}

async function collect(directory) {
    const files = []
    await walk(directory, files)
    return files.filter((file) => file.endsWith('.ts')).toSorted()
}

async function walk(directory, files) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await walk(path, files)
        else files.push(path)
    }
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
