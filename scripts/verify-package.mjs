import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const temp = mkdtempSync(join(tmpdir(), 'intelligent-compact-pkg-consumer-'))

const core = {
    name: '@intelligent-compact/core',
    directory: join(root, 'packages/core'),
}
const adapter = {
    name: '@intelligent-compact/claude-code',
    directory: join(root, 'packages/claude-code'),
}

function run(command, args, cwd) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, CI: '1', NO_COLOR: '1' },
        shell: false,
    })
    if (result.status !== 0) {
        throw new Error(
            `${command} ${args.join(' ')} failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
        )
    }
    return result.stdout ?? ''
}

function write(path, content) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
}

function pack(pkg) {
    const destination = join(temp, `pack-${pkg.name.replaceAll('/', '-')}`)
    mkdirSync(destination, { recursive: true })
    run('pnpm', ['pack', '--pack-destination', destination], pkg.directory)
    const tarball = readdirSync(destination).find((name) =>
        name.endsWith('.tgz')
    )
    if (!tarball)
        throw new Error(`pnpm pack did not produce a tarball for ${pkg.name}`)
    return join(destination, tarball)
}

function verifyCore() {
    const tarball = pack(core)
    const consumer = join(temp, 'core-consumer')
    mkdirSync(consumer, { recursive: true })
    write(
        join(consumer, 'package.json'),
        `${JSON.stringify(
            {
                name: 'intelligent-compact-core-consumer',
                private: true,
                type: 'module',
                dependencies: {
                    [core.name]: `file:${tarball}`,
                },
                devDependencies: {
                    '@types/node': '24.10.0',
                    typescript: '7.0.2',
                },
            },
            null,
            4
        )}\n`
    )
    write(
        join(consumer, 'esm.mjs'),
        `import { ContextPilotController, PolicyRegistry } from '${core.name}'\n` +
            `if (typeof ContextPilotController !== 'function') throw new Error('ESM controller export failed')\n` +
            `if (typeof PolicyRegistry !== 'function') throw new Error('ESM registry export failed')\n` +
            `console.log('core ESM contract ok')\n`
    )
    write(
        join(consumer, 'cjs.cjs'),
        `const { ContextPilotController, PolicyRegistry } = require('${core.name}')\n` +
            `if (typeof ContextPilotController !== 'function') throw new Error('CJS controller export failed')\n` +
            `if (typeof PolicyRegistry !== 'function') throw new Error('CJS registry export failed')\n` +
            `console.log('core CJS contract ok')\n`
    )
    write(
        join(consumer, 'index.ts'),
        `import { PolicyRegistry, type PolicyRegistryData } from '${core.name}'\n` +
            `declare const data: PolicyRegistryData\n` +
            `const registry: PolicyRegistry = new PolicyRegistry(data)\n` +
            `void registry\n`
    )
    write(
        join(consumer, 'tsconfig.json'),
        `${JSON.stringify(
            {
                compilerOptions: {
                    strict: true,
                    target: 'es2021',
                    module: 'esnext',
                    moduleResolution: 'Bundler',
                    noEmit: true,
                    skipLibCheck: true,
                },
                include: ['index.ts'],
            },
            null,
            4
        )}\n`
    )

    run('pnpm', ['install', '--ignore-workspace'], consumer)
    run(process.execPath, ['esm.mjs'], consumer)
    run(process.execPath, ['cjs.cjs'], consumer)
    run('pnpm', ['exec', 'tsc', '--noEmit'], consumer)
}

function verifyAdapter() {
    const tarball = pack(adapter)
    const unpacked = join(temp, 'adapter-unpacked')
    mkdirSync(unpacked, { recursive: true })
    run('tar', ['-xzf', tarball, '-C', unpacked], temp)

    const packageDir = join(unpacked, 'package')
    const registerPath = join(packageDir, 'dist/register.js')
    const hooksPath = join(packageDir, 'hooks/hooks.json')
    const manifestPath = join(packageDir, '.claude-plugin/plugin.json')

    for (const [label, path] of [
        ['built register', registerPath],
        ['hooks metadata', hooksPath],
        ['plugin manifest', manifestPath],
    ]) {
        if (!existsSync(path)) {
            throw new Error(`packed adapter is missing ${label}: ${path}`)
        }
    }

    const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'))
    const modulePath = hooks.modules?.[0]
    if (typeof modulePath !== 'string') {
        throw new Error('hooks.json does not declare a module')
    }
    const hookModulePath = join(packageDir, 'hooks', modulePath)
    if (!existsSync(hookModulePath)) {
        throw new Error(`hooks.json points to a missing module: ${modulePath}`)
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const registryJson = manifest.userConfig?.policy_registry_json?.default
    if (typeof registryJson !== 'string') {
        throw new Error('plugin manifest is missing policy_registry_json')
    }
    const registry = JSON.parse(registryJson)
    if (registry.schemaVersion !== 2) {
        throw new Error(
            `default policy registry must be schemaVersion 2, got ${registry.schemaVersion}`
        )
    }
    const packageJson = JSON.parse(
        readFileSync(join(packageDir, 'package.json'), 'utf8')
    )
    if (manifest.version !== packageJson.version) {
        throw new Error(
            `plugin manifest version ${manifest.version} differs from package version ${packageJson.version}`
        )
    }

    run(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `const module = await import(${JSON.stringify(pathToFileURL(hookModulePath).href)})\n` +
                `if (typeof module.register !== 'function') throw new Error('register export missing')\n` +
                `console.log('adapter register contract ok')\n`,
        ],
        packageDir
    )
}

try {
    verifyCore()
    verifyAdapter()
    process.stdout.write('package contract verification passed\n')
} finally {
    rmSync(temp, { recursive: true, force: true })
}
