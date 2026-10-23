import { describe, expect, it } from 'vitest'
import { PolicyRegistry, PolicyRegistryCodec } from '@intelligent-compact/core'
import { register } from '../register'

const policyData = {
    id: 'test',
    label: 'Test policy',
    thresholds: {
        arm: { unit: 'tokens' as const, value: 325_000 },
        mandatory: { unit: 'tokens' as const, value: 500_000 },
        hostHeadroom: { unit: 'tokens' as const, value: 50_000 },
    },
    probe: {
        minGap: { unit: 'tokens' as const, value: 5_000 },
        maxGap: { unit: 'tokens' as const, value: 50_000 },
        maxProbesPerCycle: 5,
        cacheFloor: 0.7,
    },
    compaction: {
        minProgress: { unit: 'tokens' as const, value: 50_000 },
        directiveMaxChars: 900,
        forkOnMandatory: true,
        injectNative: true,
        baseInstructions: 'Preserve task state.',
    },
}

type Handler = (...args: any[]) => any

function registryJson(): string {
    return new PolicyRegistryCodec().stringify(
        new PolicyRegistry({
            schemaVersion: 2,
            activePolicyId: 'test',
            policies: [policyData],
        })
    )
}

function options(): Record<string, unknown> {
    return {
        auto_enabled: true,
        show_status_band: true,
        policy_registry_json: registryJson(),
    }
}

function element(type: string) {
    return (props: Record<string, unknown>) => ({ type, props })
}

function makeUi(withConfig = true): Record<string, unknown> {
    return {
        Box: element('Box'),
        Text: element('Text'),
        Button: element('Button'),
        ...(withConfig
            ? { Input: element('Input'), Select: element('Select') }
            : {}),
    }
}

const nextEvent = async () => ({
    tokensBefore: 200_000,
    tokensAfter: 50_000,
})

function textOf(node: unknown): string {
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (typeof node === 'string' || typeof node === 'number')
        return String(node)
    if (typeof node !== 'object' || node === null) return ''
    const value = node as { props?: { children?: unknown } }
    return textOf(value.props?.children)
}

/** `$.state` outlives a reload: pass one map to both copies of the plugin. */
function setup(
    pluginState = new Map<string, unknown>(),
    pluginOptions = options()
) {
    const handlers = new Map<string, Handler>()
    // `.catch(...)` registers an error hook; the fake engine never fails a hook.
    const registration = { catch: () => registration }
    const matched = new Map<string, Handler>()
    let compactTriggers: readonly string[] = []
    const on = (event: string, matcherOrHook: unknown, maybeHook?: Handler) => {
        if (typeof matcherOrHook === 'function') {
            handlers.set(event, matcherOrHook as Handler)
            return registration
        }
        const matcher = matcherOrHook as {
            component?: string
            command?: string
            trigger?: readonly string[]
        }
        if (matcher.trigger) {
            compactTriggers = matcher.trigger
            handlers.set(event, maybeHook as Handler)
            return registration
        }
        const key = matcher.component
            ? `ui.render:${matcher.component}`
            : `${event}:${matcher.command}`
        matched.set(key, maybeHook as Handler)
        return registration
    }

    register(on as never, pluginOptions as never)

    const usage = {
        context: {
            tokens: 100_000,
            window: 1_000_000,
            percent: 10,
            breakdown: {
                autoCompactThreshold: 600_000,
                isAutoCompactEnabled: true,
            },
        },
    }
    const replies: unknown[] = []
    const compactCalls: string[] = []
    const store = new Map<string, unknown>()
    let forkCalls = 0
    let usageReads = 0
    let invalidations = 0
    let opened = 0
    let commandRegistration: unknown
    let currentUi = makeUi()

    const engine = {
        session: {
            usage: async () => {
                usageReads += 1
                return usage
            },
            compact: async (args?: { instructions?: string }) => {
                compactCalls.push(args?.instructions ?? '')
                return {
                    tokensBefore: usage.context.tokens,
                    tokensAfter: 50_000,
                }
            },
            id: async () => 'session',
        },
        model: {
            fork: async () => {
                forkCalls += 1
                return (
                    replies.shift() ?? {
                        isAnswered: false,
                        reason: 'nothing-to-fork',
                    }
                )
            },
        },
        state: {
            get: async (ref: { key: string }) => ({
                value: pluginState.get(ref.key),
                version: 0,
            }),
            set: async (ref: { key: string }, value: unknown) => {
                pluginState.set(ref.key, JSON.parse(JSON.stringify(value)))
                return { isSet: true, version: 1 }
            },
        },
        store: {
            get: async (key: string) => store.get(key),
            set: async (key: string, value: unknown) => {
                store.set(key, value)
            },
        },
        ui: {
            toast: async () => {},
            invalidate: async () => {
                invalidations += 1
            },
            open: async () => {
                opened += 1
            },
            resolve: () => currentUi,
        },
        config: { set: async () => ({ value: true }) },
        command: {
            register: async (args: unknown) => {
                commandRegistration = args
            },
        },
    }

    const standard = (event: string) => handlers.get(event) as Handler
    const matcher = (key: string) => matched.get(key) as Handler

    return {
        engine,
        usage,
        replies,
        compactCalls,
        store,
        next: nextEvent,
        standard,
        matcher,
        compactTriggers: () => compactTriggers,
        setForkCalls: () => forkCalls,
        usageReads: () => usageReads,
        pluginState,
        invalidations: () => invalidations,
        opened: () => opened,
        commandRegistration: () => commandRegistration,
        setUi: (ui: Record<string, unknown>) => {
            currentUi = ui
        },
    }
}

function mainTurn(state: ReturnType<typeof setup>) {
    return state.standard('turn.complete')(
        state.engine,
        { agentId: undefined, reason: 'answer' },
        state.next
    )
}

async function compact(
    state: ReturnType<typeof setup>,
    event: Record<string, unknown>
) {
    const received: unknown[] = []
    const result = await state.standard('session.compact')(
        state.engine,
        event,
        async (forwarded: unknown) => {
            received.push(forwarded)
            return { tokensBefore: 200_000, tokensAfter: 50_000 }
        }
    )
    return { received, result }
}

async function started() {
    const state = setup()
    await state.standard('session.start')(
        state.engine,
        { isInteractive: true },
        state.next
    )
    return state
}

describe('claude-code register', () => {
    it('registers the command on session start', async () => {
        const state = setup()
        await state.standard('session.start')(
            state.engine,
            { isInteractive: true },
            state.next
        )
        expect(state.commandRegistration()).toMatchObject({
            name: 'context-pilot',
        })
        expect(state.invalidations()).toBeGreaterThan(0)
    })

    it('only probes after eligible main turns', async () => {
        const state = setup()
        await state.standard('session.start')(
            state.engine,
            { isInteractive: true },
            state.next
        )

        await state.standard('turn.complete')(
            state.engine,
            { agentId: 'subagent', reason: 'answer' },
            state.next
        )
        expect(state.setForkCalls()).toBe(0)

        await state.standard('turn.complete')(
            state.engine,
            { agentId: undefined, reason: 'aborted' },
            state.next
        )
        expect(state.setForkCalls()).toBe(0)

        state.usage.context.tokens = 325_000
        state.replies.push({
            isAnswered: true,
            text: '{"a":"W","n":350000}',
            usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_read_input_tokens: 10,
                cache_creation_input_tokens: 0,
            },
        })
        await state.standard('turn.complete')(
            state.engine,
            { agentId: undefined, reason: 'answer' },
            state.next
        )
        expect(state.setForkCalls()).toBe(1)
    })

    it('never forks automatically in a headless session', async () => {
        const state = setup()
        await state.standard('session.start')(
            state.engine,
            { isInteractive: false },
            state.next
        )
        state.usage.context.tokens = 400_000
        await state.standard('turn.complete')(
            state.engine,
            { agentId: undefined, reason: 'answer' },
            state.next
        )
        expect(state.setForkCalls()).toBe(0)
    })

    it('handles commands and reports status', async () => {
        const state = setup()
        await state.standard('session.start')(
            state.engine,
            { isInteractive: true },
            state.next
        )
        const command = state.matcher('command.run:context-pilot')

        const dashboard = await command(state.engine, { args: '' })
        expect(dashboard).toEqual({})
        expect(state.opened()).toBe(1)

        // The settings pane opens alone, so it takes the focus.
        await command(state.engine, { args: 'config' })
        expect(state.opened()).toBe(2)

        state.usage.context.tokens = 325_000
        state.replies.push({
            isAnswered: true,
            text: '{"a":"W","n":350000}',
            usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_read_input_tokens: 10,
                cache_creation_input_tokens: 0,
            },
        })
        await state.standard('turn.complete')(
            state.engine,
            { agentId: undefined, reason: 'answer' },
            state.next
        )
        const status = await command(state.engine, { args: 'status' })
        expect(status.text).toContain('test')
        expect(status.text).toContain('WAIT')
        expect(status.text).toContain('next 350k')

        state.replies.push({ isAnswered: false, reason: 'nothing-to-fork' })
        await command(state.engine, { args: 'evaluate' })
        await command(state.engine, { args: 'compact' })
        expect(state.compactCalls.length).toBe(1)

        const usage = await command(state.engine, { args: 'unknown' })
        expect(usage.text).toContain('Usage: /context-pilot')
    })

    it('renders the status band and pane, and ignores foreign panes', async () => {
        const state = setup()
        await state.standard('session.start')(
            state.engine,
            { isInteractive: true },
            state.next
        )

        state.usage.context.tokens = 325_000
        state.replies.push({
            isAnswered: true,
            text: '{"a":"W","n":350000}',
            usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_read_input_tokens: 10_000,
                cache_creation_input_tokens: 0,
            },
        })
        await state.standard('turn.complete')(
            state.engine,
            { agentId: undefined, reason: 'answer' },
            state.next
        )

        const band = await state.matcher('ui.render:AbovePrompt')(
            state.engine,
            { surface: 'terminal' },
            state.next
        )
        expect(textOf(band)).toContain('context-pilot test')

        const pane = await state.matcher('ui.render:Pane')(
            state.engine,
            { requestId: 'context-pilot', surface: 'terminal' },
            state.next
        )
        expect(textOf(pane)).toContain('context-pilot')
        expect(textOf(pane)).toContain('100.0% cached')
        expect(textOf(pane)).toContain('1 call  ')

        const foreign = await state.matcher('ui.render:Pane')(
            state.engine,
            { requestId: 'other', surface: 'terminal' },
            state.next
        )
        expect(foreign).toMatchObject({ tokensBefore: 200_000 })

        state.setUi(makeUi(false))
        await state.standard('session.measure')(
            state.engine,
            {
                context: { tokens: 400_000, window: 1_000_000, percent: 40 },
            },
            state.next
        )
        expect(state.invalidations()).toBeGreaterThan(0)
    })

    it('observes external compaction without failing the turn', async () => {
        const state = setup()
        await state.standard('session.start')(
            state.engine,
            { isInteractive: true },
            state.next
        )
        const result = await state.standard('session.compact')(
            state.engine,
            { agentId: undefined, trigger: 'auto' },
            state.next
        )
        expect(result).toMatchObject({ tokensBefore: 200_000 })
    })

    describe('session.compact', () => {
        it('injects the policy instructions into native compactions', async () => {
            const state = await started()
            const event = { agentId: undefined, trigger: 'auto' }
            const { received } = await compact(state, event)
            expect(received).toEqual([
                { ...event, instructions: 'Preserve task state.' },
            ])
        })

        it('keeps the typed /compact text first', async () => {
            const state = await started()
            const { received } = await compact(state, {
                agentId: undefined,
                trigger: 'manual',
                instructions: 'foo',
            })
            const forwarded = received[0] as { instructions: string }
            expect(forwarded.instructions.startsWith('foo')).toBe(true)
            expect(forwarded.instructions).toContain('Preserve task state.')
        })

        it('never hooks plugin-triggered compactions', async () => {
            const state = await started()
            expect(state.compactTriggers()).toEqual([
                'auto',
                'manual',
                'precompute',
            ])
        })

        it('leaves subagent compactions unchanged', async () => {
            const state = await started()
            const event = { agentId: 'sub', trigger: 'auto' }
            const { received } = await compact(state, event)
            expect(received[0]).toBe(event)
            const pane = await state.matcher('ui.render:Pane')(
                state.engine,
                { requestId: 'context-pilot', surface: 'terminal' },
                state.next
            )
            expect(textOf(pane)).toContain('0 compactions · 0 probes')
        })

        it('opens a new cycle and persists telemetry for an observed auto compaction', async () => {
            const state = await started()
            expect(state.store.has('telemetry')).toBe(false)
            await compact(state, { agentId: undefined, trigger: 'auto' })

            const stored = state.store.get('telemetry') as {
                counters: { compactions: number }
                compactions: Array<{ source: string; before: number }>
            }
            expect(stored.counters.compactions).toBe(1)
            expect(stored.compactions).toMatchObject([
                { source: 'auto', before: 200_000 },
            ])

            const pane = await state.matcher('ui.render:Pane')(
                state.engine,
                { requestId: 'context-pilot', surface: 'terminal' },
                state.next
            )
            // the host counts its result over the transcript only: the live
            // fill and the cycle baseline wait for the next measurement
            expect(textOf(pane)).toContain('— / 1.00M')
            expect(textOf(pane)).toContain('Progress      — / 50k')
            expect(textOf(pane)).toContain('200k → 50k')
        })
    })

    it('writes telemetry at session end and loads it at the next start', async () => {
        const state = setup()
        await state.standard('session.start')(
            state.engine,
            { isInteractive: true },
            state.next
        )
        await state.standard('session.compact')(
            state.engine,
            { agentId: undefined, trigger: 'auto' },
            state.next
        )
        state.store.delete('telemetry')

        await state.standard('session.end')(state.engine, {}, state.next)
        expect(state.store.has('telemetry')).toBe(true)

        await state.standard('session.start')(
            state.engine,
            { isInteractive: true },
            state.next
        )
        const pane = await state.matcher('ui.render:Pane')(
            state.engine,
            { requestId: 'context-pilot', surface: 'terminal' },
            state.next
        )
        expect(textOf(pane)).toContain('1 compaction · 0 probes')
        expect(textOf(pane)).toContain('probes 0 · waits 0')
        expect(textOf(pane)).toContain('compacts 0')
    })

    describe('/clear (session.end without a later session.start)', () => {
        const WAIT_REPLY = {
            isAnswered: true,
            text: '{"a":"W","n":360000}',
            usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_read_input_tokens: 10,
                cache_creation_input_tokens: 0,
            },
        }
        it('drops the post-compaction baseline wait of the old conversation', async () => {
            const state = setup()
            await state.standard('session.start')(
                state.engine,
                { isInteractive: true },
                state.next
            )
            state.usage.context.tokens = 520_000
            await mainTurn(state)
            expect(state.compactCalls.length).toBe(1)

            await state.standard('session.end')(
                state.engine,
                { reason: 'clear' },
                state.next
            )
            state.usage.context.tokens = 330_000
            const forks = state.setForkCalls()
            state.replies.push(WAIT_REPLY)
            await mainTurn(state)

            const command = state.matcher('command.run:context-pilot')
            const status = await command(state.engine, { args: 'status' })
            expect(state.setForkCalls()).toBe(forks + 1)
            expect(status.text).not.toContain('progress guard')
            expect(status.text).toContain('probes 1/5')
            expect(status.text).toContain('WAIT')
        })

        it('resets even when telemetry cannot be stored', async () => {
            const state = setup()
            await state.standard('session.start')(
                state.engine,
                { isInteractive: true },
                state.next
            )
            state.usage.context.tokens = 330_000
            state.replies.push(WAIT_REPLY)
            await mainTurn(state)
            const command = state.matcher('command.run:context-pilot')
            expect(
                (await command(state.engine, { args: 'status' })).text
            ).toContain('probes 1/5')

            state.engine.store.set = async () => {
                throw new Error('disk full')
            }
            await state.standard('session.end')(
                state.engine,
                { reason: 'clear' },
                state.next
            )
            const cleared = await command(state.engine, { args: 'status' })
            expect(cleared.text).toContain('Not evaluated')
            expect(cleared.text).toContain('Telemetry not saved: disk full')
            expect(cleared.text).not.toContain('WAIT')

            state.replies.push(WAIT_REPLY)
            await mainTurn(state)
            expect(
                (await command(state.engine, { args: 'status' })).text
            ).toContain('probes 1/5')
        })
    })

    it('ignores corrupt stored telemetry', async () => {
        const state = setup()
        state.store.set('telemetry', { version: 99 })
        await state.standard('session.start')(
            state.engine,
            { isInteractive: true },
            state.next
        )
        const pane = await state.matcher('ui.render:Pane')(
            state.engine,
            { requestId: 'context-pilot', surface: 'terminal' },
            state.next
        )
        expect(textOf(pane)).toContain('0 compactions · 0 probes')
    })

    it('reports probes and OBSERVE in the status of a headless session', async () => {
        const state = setup()
        await state.standard('session.start')(
            state.engine,
            { isInteractive: false },
            state.next
        )
        const status = await state.matcher('command.run:context-pilot')(
            state.engine,
            { args: 'status' }
        )
        expect(status.text).toContain('probes 0/5')
        expect(status.text).toContain('OBSERVE')
        expect(status.text).not.toContain('AUTO')
    })

    it('fails loudly when the injected registry is missing', () => {
        expect(() => register((() => {}) as never, {} as never)).toThrow(
            /must be configured/
        )
    })
})

function findKey(node: unknown, key: string): { props: any } | undefined {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findKey(child, key)
            if (found) return found
        }
        return undefined
    }
    if (typeof node !== 'object' || node === null) return undefined
    const value = node as { props?: { key?: unknown; children?: unknown } }
    if (value.props?.key === key) return value as { props: any }
    return findKey(value.props?.children, key)
}

const WAIT_PROBE = {
    isAnswered: true,
    text: '{"a":"W","n":350000}',
    usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 10_000,
        cache_creation_input_tokens: 0,
    },
}

async function statusOf(state: ReturnType<typeof setup>): Promise<string> {
    const result = await state.matcher('command.run:context-pilot')(
        state.engine,
        { args: 'status' }
    )
    return (result as { text: string }).text
}

function reloadedOptions(): Record<string, unknown> {
    const registry = new PolicyRegistry({
        schemaVersion: 2,
        activePolicyId: 'test',
        policies: [
            {
                ...policyData,
                probe: { ...policyData.probe, maxProbesPerCycle: 7 },
            },
        ],
    })
    return {
        ...options(),
        policy_registry_json: new PolicyRegistryCodec().stringify(registry),
    }
}

async function probedOnce() {
    const shared = new Map<string, unknown>()
    const first = setup(shared)
    await first.standard('session.start')(
        first.engine,
        { isInteractive: true },
        first.next
    )
    first.usage.context.tokens = 325_000
    first.replies.push(WAIT_PROBE)
    await mainTurn(first)
    return { shared, first }
}

describe('settings reload (register runs again in the same session)', () => {
    it('keeps the cycle and decision and applies the new options', async () => {
        const { shared, first } = await probedOnce()
        expect(await statusOf(first)).toContain('probes 1/5')

        const second = setup(shared, reloadedOptions())
        second.usage.context.tokens = 325_000
        await second.standard('session.start')(
            second.engine,
            { isInteractive: true },
            second.next
        )
        const text = await statusOf(second)
        expect(text).toContain('probes 1/7')
        expect(text).toContain('325k/1.00M')
        expect(text).toMatch(/WAIT/)
    })

    it('starts fresh from a carry of another session', async () => {
        const { shared } = await probedOnce()
        const carry = shared.get('session') as {
            controller: { sessionId: string }
        }
        carry.controller.sessionId = 'another'

        const second = setup(shared)
        await second.standard('session.start')(
            second.engine,
            { isInteractive: true },
            second.next
        )
        const text = await statusOf(second)
        expect(text).toContain('probes 0/5')
        expect(text).toContain('Not evaluated')
    })

    it('clears the carry when the session ends', async () => {
        const { shared, first } = await probedOnce()
        await first.standard('session.end')(first.engine, {}, first.next)
        expect(shared.get('session')).toEqual({
            controller: null,
            view: null,
        })
    })

    it('reopens the editor on the saved policy with its notice', async () => {
        const shared = new Map<string, unknown>()
        const first = setup(shared)
        await first.standard('session.start')(
            first.engine,
            { isInteractive: true },
            first.next
        )
        await first.matcher('command.run:context-pilot')(first.engine, {
            args: 'config',
        })
        const pane = await first.matcher('ui.render:Pane')(
            first.engine,
            { requestId: 'context-pilot-settings', surface: 'terminal' },
            first.next
        )
        await findKey(pane, 'save-policy')?.props.onPress()

        const second = setup(shared)
        await second.standard('session.start')(
            second.engine,
            { isInteractive: true },
            second.next
        )
        const reopened = textOf(
            await second.matcher('ui.render:Pane')(
                second.engine,
                { requestId: 'context-pilot-settings', surface: 'terminal' },
                second.next
            )
        )
        expect(reopened).toContain('✓ Saved test · applied to this session')
    })
})

describe('live context between turn ends', () => {
    it('reads the fill at each main-thread tool call', async () => {
        const state = await started()
        state.usage.context.tokens = 412_000
        const before = state.invalidations()
        const forwarded = await state.standard('tool.call')(
            state.engine,
            { tool: 'Read', agentId: undefined },
            async () => ({ result: 'ok' })
        )
        expect(forwarded).toEqual({ result: 'ok' })
        expect(state.invalidations()).toBeGreaterThan(before)

        const band = await state.matcher('ui.render:AbovePrompt')(
            state.engine,
            { surface: 'terminal' },
            state.next
        )
        expect(textOf(band)).toContain('412k/1.00M')
    })

    it('leaves subagent tool calls alone and redraws only on a change', async () => {
        const state = await started()
        const reads = state.usageReads()
        await state.standard('tool.call')(
            state.engine,
            { tool: 'Read', agentId: 'sub' },
            async () => ({ result: 'ok' })
        )
        expect(state.usageReads()).toBe(reads)

        const before = state.invalidations()
        await state.standard('tool.call')(
            state.engine,
            { tool: 'Read', agentId: undefined },
            async () => ({ result: 'ok' })
        )
        expect(state.usageReads()).toBe(reads + 1)
        expect(state.invalidations()).toBe(before)
    })
})
