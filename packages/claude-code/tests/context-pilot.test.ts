import { expect, test } from 'claude-code/testing'

const USAGE = {
    context: {
        tokens: 100_000,
        window: 1_000_000,
        percent: 10,
    },
    rateLimits: [],
    cost: { usd: 0 },
}

type StubOn = (name: string, handler: (...args: any[]) => any) => unknown

/** Stands for the engine beneath the plugin; returns the plugin's `$.store`. */
function stubBootstrap(on: StubOn, usage: typeof USAGE): Map<string, unknown> {
    const store = new Map<string, unknown>()
    on('store.get', (_$, e: { key: string }) => ({ value: store.get(e.key) }))
    on('store.set', (_$, e: { key: string; value: unknown }) => {
        store.set(e.key, e.value)
        return { value: undefined }
    })
    on('session.start', () => ({ cwd: '/work' }))
    on('command.register', () => ({ value: undefined }))
    on('session.id', () => ({ value: 'test-session' }))
    on('session.usage', () => ({ value: usage }))
    return store
}

test('status command reports the injected policy', async ($, on) => {
    stubBootstrap(on, USAGE)
    await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/work',
    })

    const answer = await $.command.run({
        command: 'context-pilot',
        args: 'status',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 100 },
    })

    expect(answer.text).toContain('balanced')
    expect(answer.text).toContain('AUTO')
})

test('the status band draws above the prompt', async ($, on) => {
    stubBootstrap(on, USAGE)
    on('ui.render', () => ({
        type: 'Text',
        props: {},
        children: ['engine band'],
    }))
    await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/work',
    })

    for (const surface of ['terminal', 'desktop'] as const) {
        const ui = await $.ui.mount({
            plugin: 'context-pilot',
            component: 'AbovePrompt',
            requestId: 'band',
            surface,
            viewport: { columns: 100, rows: 30 },
            props: {
                hasSurvey: false,
                isWorking: false,
                maxRows: 3,
                bodyColumns: 100,
                scroll: { offset: 0, bodyRows: 1 },
                view: {},
            },
        })

        expect(
            await ui.find({
                type: 'Text',
                text: /context-pilot balanced/,
            })
        ).toBeDefined()
        await ui.unmount()
    }
})

test('the dashboard pane draws the active policy', async ($, on) => {
    stubBootstrap(on, USAGE)
    await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/work',
    })

    for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
        const ui = await $.ui.mount({
            plugin: 'context-pilot',
            component: 'Pane',
            requestId: 'context-pilot',
            surface,
            viewport: { columns: 100, rows: 30, isFullscreen: true },
            props: {
                title: 'context-pilot',
                isFocused: true,
                bodyColumns: 60,
                placement: 'inline',
                scroll: { offset: 0, bodyRows: 10 },
                view: {},
            },
        })

        expect(
            await ui.find({ type: 'Text', text: /context-pilot/ })
        ).toBeDefined()
        await ui.unmount()
    }
})

test('the policy editor draws on input surfaces', async ($, on) => {
    stubBootstrap(on, USAGE)
    const opened: string[] = []
    on('ui.open', (_$, e) => {
        opened.push(e.id)
        return { value: { isPlaced: true } }
    })
    await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/work',
    })
    await $.command.run({
        command: 'context-pilot',
        args: 'config',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 100 },
    })
    expect(opened).toEqual(['context-pilot-settings'])

    for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
        const ui = await $.ui.mount({
            plugin: 'context-pilot',
            component: 'Pane',
            requestId: 'context-pilot-settings',
            surface,
            viewport: { columns: 110, rows: 40, isFullscreen: true },
            props: {
                title: 'context-pilot · settings',
                isFocused: true,
                bodyColumns: 90,
                placement: 'dock',
                scroll: { offset: 0, bodyRows: 30 },
                view: {},
            },
        })

        expect(
            await ui.find({
                type: 'Text',
                text: /Policy registry editor/,
            })
        ).toBeDefined()
        expect(await ui.find({ key: 'field-label' })).toBeDefined()
        await ui.unmount()
    }
})

test('the help view explains the registry', async ($, on) => {
    stubBootstrap(on, USAGE)
    const opened: string[] = []
    on('ui.open', (_$, e) => {
        opened.push(e.id)
        return { value: { isPlaced: true } }
    })
    await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/work',
    })
    await $.command.run({
        command: 'context-pilot',
        args: 'help',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 100 },
    })
    expect(opened).toEqual(['context-pilot-settings'])

    for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
        const ui = await $.ui.mount({
            plugin: 'context-pilot',
            component: 'Pane',
            requestId: 'context-pilot-settings',
            surface,
            viewport: { columns: 110, rows: 40, isFullscreen: true },
            props: {
                title: 'context-pilot · settings',
                isFocused: true,
                bodyColumns: 90,
                placement: 'dock',
                scroll: { offset: 0, bodyRows: 30 },
                view: {},
            },
        })

        expect(
            await ui.find({ type: 'Text', text: /Field meanings/ })
        ).toBeDefined()
        await ui.unmount()
    }
})

const COMMAND = {
    command: 'context-pilot',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
} as const

const FORK_USAGE = {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 9_000,
    cache_creation_input_tokens: 0,
}

const MESSAGES = [{ role: 'user' as const, text: 'hello', toolUses: [] }]

const MAIN_TURN = {
    turnId: 'turn-1',
    answer: 'done',
    durationMs: 1,
    isAborted: false,
    reason: 'answer',
} as const

function usageAt(tokens: number): typeof USAGE {
    return {
        ...USAGE,
        context: { tokens, window: 1_000_000, percent: tokens / 10_000 },
    }
}

test('the mandatory boundary compacts with the fork directive', async ($, on) => {
    const compacted: Array<{ trigger: string; instructions: string }> = []
    stubBootstrap(on, usageAt(510_000))
    on('turn.complete', () => ({ text: '' }))
    on('model.fork', () => ({
        value: {
            isAnswered: true,
            text: '{"a":"C","i":"preserve the lock-order hypothesis","r":"done"}',
            usage: FORK_USAGE,
        },
    }))
    on('session.compact', (_$, e) => {
        compacted.push({
            trigger: e.trigger,
            instructions: e.instructions ?? '',
        })
        return {
            messages: [{ role: 'assistant', text: 'summary', toolUses: [] }],
            tokensBefore: 510_000,
            tokensAfter: 40_000,
        }
    })
    on('ui.toast', () => ({ value: undefined }))

    await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/work',
    })
    await $.turn.complete(MAIN_TURN)

    expect(compacted).toHaveLength(1)
    expect(compacted[0]?.instructions).toContain(
        'Write a continuation summary that preserves working state'
    )
    expect(compacted[0]?.instructions).toContain(
        'Preservation directive: preserve the lock-order hypothesis'
    )
    const status = await $.command.run({ ...COMMAND, args: 'status' })
    expect(status.text).toContain('Compacted (mandatory)')
})

test('a semantic WAIT schedules the next probe without compacting', async ($, on) => {
    let compactions = 0
    let forks = 0
    stubBootstrap(on, usageAt(330_000))
    on('turn.complete', () => ({ text: '' }))
    on('model.fork', () => {
        forks += 1
        return {
            value: {
                isAnswered: true,
                text: '{"a":"W","n":345000,"r":"debug"}',
                usage: FORK_USAGE,
            },
        }
    })
    on('session.compact', () => {
        compactions += 1
        return { messages: MESSAGES }
    })

    await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/work',
    })
    await $.turn.complete(MAIN_TURN)
    await $.turn.complete({ ...MAIN_TURN, turnId: 'turn-2' })

    expect(forks).toBe(1)
    expect(compactions).toBe(0)
    const status = await $.command.run({ ...COMMAND, args: 'status' })
    expect(status.text).toContain('next 345k')
    expect(status.text).toContain('probes 1/5')
    expect(status.text).toContain('WAIT (debug)')
})

test('subagent turns never probe', async ($, on) => {
    let forks = 0
    stubBootstrap(on, usageAt(400_000))
    on('turn.complete', () => ({ text: '' }))
    on('model.fork', () => {
        forks += 1
        return { value: { isAnswered: false, reason: 'nothing-to-fork' } }
    })
    await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/work',
    })
    await $.turn.complete({ ...MAIN_TURN, agentId: 'agent-1' })
    await $.turn.complete({ ...MAIN_TURN, reason: 'aborted', isAborted: true })
    expect(forks).toBe(0)
})

test('a headless session observes and never forks', async ($, on) => {
    let forks = 0
    stubBootstrap(on, usageAt(600_000))
    on('turn.complete', () => ({ text: '' }))
    on('model.fork', () => {
        forks += 1
        return { value: { isAnswered: false, reason: 'nothing-to-fork' } }
    })
    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    await $.turn.complete(MAIN_TURN)

    expect(forks).toBe(0)
    const status = await $.command.run({ ...COMMAND, args: 'status' })
    expect(status.text).toContain('OBSERVE')
})

test('native compactions receive the policy instructions', async ($, on) => {
    const seen: Array<{ trigger: string; instructions: string | undefined }> =
        []
    stubBootstrap(on, usageAt(200_000))
    on('session.compact', (_$, e) => {
        seen.push({ trigger: e.trigger, instructions: e.instructions })
        return {
            messages: MESSAGES,
            tokensBefore: 900_000,
            tokensAfter: 45_000,
        }
    })
    await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/work',
    })

    await $.session.compact({
        trigger: 'manual',
        instructions: 'keep the parser plan',
        messages: MESSAGES,
    })
    await $.session.compact({ trigger: 'auto', messages: MESSAGES })
    await $.session.compact({ trigger: 'precompute', messages: MESSAGES })
    await $.session.compact({
        trigger: 'auto',
        agentId: 'agent-1',
        messages: MESSAGES,
    })

    expect(seen[0]?.instructions?.startsWith('keep the parser plan\n\n')).toBe(
        true
    )
    for (const call of seen.slice(0, 3))
        expect(call.instructions).toContain(
            'Write a continuation summary that preserves working state'
        )
    expect(seen[3]?.instructions).toBeUndefined()

    const status = await $.command.run({ ...COMMAND, args: 'status' })
    expect(status.text).toContain('Observed auto compaction')
})

test('evaluate is a dry run', async ($, on) => {
    let compactions = 0
    stubBootstrap(on, usageAt(400_000))
    on('model.fork', () => ({
        value: {
            isAnswered: true,
            text: '{"a":"C","i":"keep X","r":"switch"}',
            usage: FORK_USAGE,
        },
    }))
    on('session.compact', () => {
        compactions += 1
        return { messages: MESSAGES }
    })
    await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/work',
    })
    const answer = await $.command.run({ ...COMMAND, args: 'evaluate' })
    expect(answer.text).toContain(
        'COMPACT recommended (switch); nothing executed'
    )
    expect(compactions).toBe(0)
})

test('lifetime telemetry survives a session end and restart', async ($, on) => {
    const store = stubBootstrap(on, usageAt(200_000))
    on('session.compact', () => ({
        messages: MESSAGES,
        tokensBefore: 900_000,
        tokensAfter: 45_000,
    }))
    on('session.end', () => ({ sessionId: 'test-session' }))
    await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/work',
    })
    await $.session.compact({ trigger: 'auto', messages: MESSAGES })
    await $.session.end({
        reason: 'clear',
        sessionId: 'test-session',
        resume: { id: 'test-session' },
    })
    await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/work',
    })

    const stored = store.get('telemetry') as {
        counters: { compactions: number; injections: number }
    }
    expect(stored.counters.compactions).toBe(1)
    expect(stored.counters.injections).toBe(1)
    // The restart loaded the lifetime data back: a second compaction adds to it.
    await $.session.compact({ trigger: 'auto', messages: MESSAGES })
    const after = store.get('telemetry') as {
        counters: { compactions: number }
    }
    expect(after.counters.compactions).toBe(2)
})
