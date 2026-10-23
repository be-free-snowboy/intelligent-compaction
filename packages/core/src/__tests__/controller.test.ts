import { describe, expect, it } from 'vitest'
import { DIRECTIVE_LABEL } from '../domain/instructions'
import type { ContextPilotState } from '../domain/state'
import {
    COLD,
    FakeRuntime,
    WARM,
    compact,
    controllerOf,
    turn,
    wait,
} from './support/fixtures'

async function started(
    overrides: Parameters<typeof controllerOf>[0] = {},
    settings?: Parameters<typeof controllerOf>[1],
    tokens = 100_000
) {
    const controller = controllerOf(overrides, settings)
    const runtime = new FakeRuntime()
    runtime.tokens = tokens
    await controller.initialize(runtime)
    return { controller, runtime, state: controller.snapshot }
}

// Runs `change` once, inside the invalidation that precedes the host call.
function onCompacting(
    runtime: FakeRuntime,
    state: ContextPilotState,
    change: () => void
): void {
    let done = false
    runtime.invalidateUi = async () => {
        if (state.mode !== 'compacting' || done) return
        done = true
        change()
    }
}

describe('arm and probe schedule', () => {
    it('never forks below arm and points the next probe at arm', async () => {
        const { controller, runtime, state } = await started()
        await turn(controller, runtime, 200_000)
        expect(runtime.forks).toHaveLength(0)
        expect(state.nextProbeAt).toBe(300_000)
        expect(state.lastDecision).toBe('Below policy arm point')
    })

    it('clamps WAIT into the probe bounds and waits for that point', async () => {
        const { controller, runtime, state } = await started()
        runtime.replies.push(wait(999_999, 'debug'))
        await turn(controller, runtime, 300_000)
        expect(state.nextProbeAt).toBe(350_000)
        expect(state.lastReason).toBe('debug')
        expect(state.lastDecision).toBe('WAIT (debug); next probe at 350k')

        await turn(controller, runtime, 340_000)
        expect(runtime.decisionForks()).toHaveLength(1)

        runtime.replies.push(wait(1))
        await turn(controller, runtime, 350_000)
        expect(state.nextProbeAt).toBe(365_000)
        expect(state.cycle.probes).toBe(2)
        expect(state.telemetry.session.waits).toBe(2)
    })

    it('puts the decision state into the probe prompt', async () => {
        const { controller, runtime } = await started()
        runtime.replies.push(wait(1))
        await turn(controller, runtime, 300_000)
        const prompt = runtime.forks[0]?.prompt ?? ''
        expect(prompt).toContain('context=300000/1000000')
        expect(prompt).toContain('nextProbeBounds=315000..350000')
        expect(prompt).toContain('probesThisCycle=0/5')
    })
})

describe('semantic compaction', () => {
    it('compacts at a COMPACT seam with the composed instructions', async () => {
        const { controller, runtime, state } = await started()
        runtime.replies.push(compact('keep A; keep B', 'green'))
        await turn(controller, runtime, 300_000)

        expect(runtime.compactions).toEqual([
            {
                instructions: `BASE\n\n${DIRECTIVE_LABEL} keep A; keep B`,
                before: 300_000,
            },
        ])
        expect(state.lastDecision).toBe('Compacted (semantic)')
        expect(state.lastCompaction).toEqual({
            before: 300_000,
            after: 30_000,
            source: 'semantic',
        })
        expect(state.compactions).toBe(1)
        // The host's `after` excludes system prompt and tools (live L-1): the
        // cycle baseline waits for the next measured turn end.
        expect(state.cycle).toMatchObject({ probes: 0, startTokens: undefined })
        expect(runtime.toasts).toBe(1)
        expect(runtime.saved).toHaveLength(1)
        expect(runtime.saved[0]?.compactions[0]).toMatchObject({
            source: 'semantic',
            probes: 1,
            directiveChars: 'keep A; keep B'.length,
        })
    })

    it('truncates the directive to the policy budget', async () => {
        const { controller, runtime } = await started({ directiveMaxChars: 15 })
        runtime.replies.push(compact('first; second; third'))
        await turn(controller, runtime, 300_000)
        expect(runtime.compactions[0]?.instructions).toBe(
            `BASE\n\n${DIRECTIVE_LABEL} first; second`
        )
    })
})

describe('mandatory pressure', () => {
    it('forks one directive and compacts at mandatory', async () => {
        const { controller, runtime, state } = await started()
        runtime.defaultReply = () => compact('lock order')
        await turn(controller, runtime, 510_000)
        expect(runtime.decisionForks()).toHaveLength(0)
        expect(runtime.directiveForks()).toHaveLength(1)
        expect(runtime.directiveForks()[0]?.prompt).toContain('(mandatory)')
        expect(runtime.compactions[0]?.instructions).toContain('lock order')
        expect(state.lastCompaction?.source).toBe('mandatory')
    })

    it('compacts without a fork when forkOnMandatory is off', async () => {
        const { controller, runtime } = await started({
            forkOnMandatory: false,
        })
        await turn(controller, runtime, 510_000)
        expect(runtime.forks).toHaveLength(0)
        expect(runtime.compactions[0]?.instructions).toBe('BASE')
    })

    it('uses an empty directive when the directive fork fails', async () => {
        const { controller, runtime, state } = await started()
        runtime.replies.push({ kind: 'answered', text: 'no json', usage: WARM })
        await turn(controller, runtime, 510_000)
        expect(runtime.compactions[0]?.instructions).toBe('BASE')
        expect(state.telemetry.session.parseFailures).toBe(1)
        expect(state.compactions).toBe(1)
    })

    it('compacts one turn early when p90 growth would cross mandatory', async () => {
        const { controller, runtime, state } = await started({
            maxProbesPerCycle: 0,
        })
        for (const fill of [300_000, 340_000, 380_000, 420_000])
            await turn(controller, runtime, fill)
        expect(runtime.compactions).toHaveLength(0)
        await turn(controller, runtime, 460_000)
        expect(runtime.compactions).toHaveLength(1)
        expect(state.lastCompaction).toMatchObject({
            before: 460_000,
            source: 'pre-mandatory',
        })
        expect(runtime.directiveForks()[0]?.prompt).toContain('(pre-mandatory)')
    })
})

describe('scheduling boundaries (CP0 J-004)', () => {
    it('uses minGap before three growth samples exist', async () => {
        const { controller, runtime, state } = await started()
        for (const [fill, expected] of [
            [300_000, 315_000],
            [320_000, 335_000],
            [340_000, 355_000],
        ] as const) {
            runtime.replies.push(wait(1))
            await turn(controller, runtime, fill)
            expect(state.nextProbeAt).toBe(expected)
        }
    })

    it('probes again at the next turn once the cap meets the fill', async () => {
        const { controller, runtime, state } = await started({
            maxProbesPerCycle: 10,
        })
        runtime.defaultReply = () => wait(999_999)
        for (const fill of [160_000, 220_000, 280_000, 340_000])
            await turn(controller, runtime, fill)
        // p90Δ = 60k: cap = max(340k, 380k) leaves room for one more turn.
        expect(state.nextProbeAt).toBe(380_000)
        await turn(controller, runtime, 400_000)
        // cap = max(400k, 380k): the next probe is the next turn.
        expect(state.nextProbeAt).toBe(400_000)
        expect(runtime.decisionForks()).toHaveLength(2)
    })
})

describe('cost guards', () => {
    it('spends at most maxProbesPerCycle probes, then holds to mandatory', async () => {
        const { controller, runtime, state } = await started({
            maxProbesPerCycle: 2,
        })
        runtime.defaultReply = (call) =>
            call.kind === 'decision' ? wait(1) : compact('d')
        for (let fill = 300_000; fill < 480_000; fill += 20_000)
            await turn(controller, runtime, fill)
        expect(runtime.decisionForks()).toHaveLength(2)
        expect(state.cycle.suspended).toBe('budget')
        expect(state.telemetry.session.budgetExhausted).toBe(1)
        expect(state.lastDecision).toBe(
            'Probe budget spent; holding to mandatory'
        )

        await turn(controller, runtime, 480_000)
        expect(state.lastCompaction?.source).toBe('pre-mandatory')
        expect(runtime.directiveForks()).toHaveLength(1)
    })

    it('runs no probes at all with a zero budget', async () => {
        const { controller, runtime } = await started({ maxProbesPerCycle: 0 })
        await turn(controller, runtime, 320_000)
        await turn(controller, runtime, 400_000)
        expect(runtime.forks).toHaveLength(0)
    })

    it('suspends probing when forks miss the cache but keeps the directive fork', async () => {
        const { controller, runtime, state } = await started()
        runtime.defaultReply = (call) =>
            call.kind === 'decision'
                ? {
                      kind: 'answered',
                      text: '{"a":"W","n":1}',
                      usage: COLD,
                  }
                : compact('d')
        await turn(controller, runtime, 300_000)
        expect(state.cycle.suspended).toBeUndefined()
        await turn(controller, runtime, 320_000)
        expect(state.cycle.suspended).toBe('cache')
        expect(state.telemetry.session.cacheTrips).toBe(1)

        await turn(controller, runtime, 360_000)
        await turn(controller, runtime, 400_000)
        expect(runtime.decisionForks()).toHaveLength(2)
        expect(state.lastDecision).toContain('miss the prompt cache')

        await turn(controller, runtime, 500_000)
        expect(runtime.directiveForks()).toHaveLength(1)
        expect(state.compactions).toBe(1)
        expect(state.cycle.suspended).toBeUndefined()
    })

    it('counts an unavailable fork only when a request was made', async () => {
        const { controller, runtime, state } = await started()
        runtime.replies.push({ kind: 'unavailable', reason: 'nothing-to-fork' })
        await turn(controller, runtime, 300_000)
        expect(state.cycle.probes).toBe(0)
        expect(state.nextProbeAt).toBe(350_000)
        expect(state.lastDecision).toBe(
            'Fork unavailable (nothing-to-fork); next probe at 350k'
        )

        runtime.replies.push({
            kind: 'unavailable',
            reason: 'api-error',
            usage: WARM,
        })
        await turn(controller, runtime, 350_000)
        expect(state.cycle.probes).toBe(1)
        expect(state.forkUsage.calls).toBe(1)
        expect(state.telemetry.session.forkUnavailable).toBe(2)
    })

    it('treats an unparseable probe as spent and defers to the upper bound', async () => {
        const { controller, runtime, state } = await started()
        runtime.replies.push({ kind: 'answered', text: 'maybe', usage: WARM })
        await turn(controller, runtime, 300_000)
        expect(state.cycle.probes).toBe(1)
        expect(state.nextProbeAt).toBe(350_000)
        expect(state.telemetry.session.parseFailures).toBe(1)
        expect(state.lastError).toContain('Unparseable probe reply')
    })
})

describe('failure backoff', () => {
    it('retries after 1, 2 and 4 turns and never re-forks the directive', async () => {
        const { controller, runtime, state } = await started()
        runtime.defaultReply = () => compact('dir')
        runtime.compactFailures = ['throw', 'skip', 'throw']

        await turn(controller, runtime, 510_000)
        expect(state.cycle).toMatchObject({ failures: 1, retryAtTurn: 2 })
        expect(state.lastDecision).toBe(
            'Compaction failed (mandatory); retry at turn 2'
        )
        expect(state.lastError).toBe('host refused')

        await turn(controller, runtime, 515_000)
        expect(state.cycle).toMatchObject({ failures: 2, retryAtTurn: 4 })
        expect(state.lastError).toBe('Compaction skipped: vetoed')

        await turn(controller, runtime, 520_000)
        expect(state.lastDecision).toBe('Compaction retry deferred to turn 4')

        await turn(controller, runtime, 525_000)
        expect(state.cycle).toMatchObject({ failures: 3, retryAtTurn: 8 })

        for (const fill of [530_000, 535_000, 540_000])
            await turn(controller, runtime, fill)
        expect(runtime.compactions).toHaveLength(0)

        await turn(controller, runtime, 545_000)
        expect(runtime.compactions).toHaveLength(1)
        expect(runtime.compactions[0]?.instructions).toContain('dir')
        expect(runtime.directiveForks()).toHaveLength(1)
        expect(state.telemetry.session.backoffs).toBe(3)
        expect(state.cycle.failures).toBe(0)
    })

    it('caps the retry delay at eight turns', async () => {
        const { controller, runtime, state } = await started({
            forkOnMandatory: false,
        })
        runtime.compactFailures = Array(50).fill('skip')
        for (let i = 0; i < 40; i += 1) await turn(controller, runtime, 510_000)
        // Attempts at turns 1, 2, 4, 8, 16, 24, 32, 40: the delay stops doubling at 8.
        expect(state.cycle.failures).toBe(8)
        expect(state.cycle.retryAtTurn).toBe(48)
    })
})

describe('pending attempts (CP0 J-003)', () => {
    it('retries a failed semantic compaction without a fork, even with probing suspended', async () => {
        const { controller, runtime, state } = await started({
            maxProbesPerCycle: 1,
        })
        runtime.replies.push(compact('seam keep'))
        runtime.compactFailures = ['throw']
        await turn(controller, runtime, 400_000)
        expect(state.cycle.pending).toEqual({
            source: 'semantic',
            directive: 'seam keep',
        })

        await turn(controller, runtime, 410_000)
        expect(runtime.forks).toHaveLength(1)
        expect(runtime.compactions[0]?.instructions).toContain('seam keep')
        expect(state.lastCompaction?.source).toBe('semantic')
        expect(state.cycle.pending).toBeUndefined()
    })

    it('keeps an empty-directive attempt pending and never re-forks it', async () => {
        const { controller, runtime, state } = await started()
        runtime.replies.push({
            kind: 'unavailable',
            reason: 'api-error',
            usage: WARM,
        })
        runtime.compactFailures = ['skip', 'skip']
        await turn(controller, runtime, 510_000)
        expect(state.cycle.pending).toEqual({
            source: 'mandatory',
            directive: '',
        })
        await turn(controller, runtime, 515_000)
        await turn(controller, runtime, 520_000)
        await turn(controller, runtime, 525_000)
        expect(runtime.directiveForks()).toHaveLength(1)
        expect(runtime.compactions).toEqual([
            { instructions: 'BASE', before: 525_000 },
        ])
    })

    it('an observed host compaction clears the pending attempt', async () => {
        const { controller, runtime, state } = await started({
            forkOnMandatory: false,
        })
        runtime.compactFailures = ['skip']
        await turn(controller, runtime, 510_000)
        controller.noteExternalCompaction('auto', 520_000, 40_000)
        expect(state.cycle.pending).toBeUndefined()
        expect(state.cycle.retryAtTurn).toBeUndefined()
    })
})

describe('progress guard and cycle baseline', () => {
    it('outranks mandatory (CP0 J-002 example)', async () => {
        const { controller, runtime, state } = await started({
            forkOnMandatory: false,
        })
        await turn(controller, runtime, 510_000)
        // First turn end after the compaction measures 450k: the cycle baseline.
        await turn(controller, runtime, 450_000)
        expect(state.cycle.startTokens).toBe(450_000)
        await turn(controller, runtime, 500_000)
        expect(runtime.compactions).toHaveLength(1)
        expect(state.lastDecision).toBe(
            'Below progress guard (50k of 150k since compaction)'
        )
        await turn(controller, runtime, 600_000)
        expect(runtime.compactions).toHaveLength(2)
    })

    it('blocks back-to-back compactions that achieve nothing', async () => {
        const { controller, runtime, state } = await started()
        runtime.defaultReply = () => compact('d')
        await turn(controller, runtime, 510_000)
        await turn(controller, runtime, 520_000)
        expect(state.cycle.startTokens).toBe(520_000)
        await turn(controller, runtime, 560_000)
        expect(runtime.compactions).toHaveLength(1)
        expect(state.lastDecision).toBe(
            'Below progress guard (40k of 150k since compaction)'
        )

        await turn(controller, runtime, 670_000)
        expect(runtime.compactions).toHaveLength(2)
    })

    it('takes the next turn-end fill as baseline when the host reports none', async () => {
        const { controller, runtime, state } = await started()
        runtime.after = undefined
        runtime.defaultReply = () => compact('d')
        await turn(controller, runtime, 510_000)
        expect(state.cycle.startTokens).toBeUndefined()
        await turn(controller, runtime, 50_000)
        expect(state.cycle.startTokens).toBe(50_000)
    })

    it('records growth over the turns after a compaction', async () => {
        const { controller, runtime, state } = await started({
            forkOnMandatory: false,
        })
        await turn(controller, runtime, 510_000)
        // 40k is the first measured fill (baseline); then +15k, +20k, +25k.
        for (const fill of [40_000, 55_000, 75_000, 100_000])
            await turn(controller, runtime, fill)
        expect(state.telemetry.lastCompactions(1)[0]?.growthAfter).toBe(60_000)
    })
})

describe('automation gates', () => {
    it('does nothing automatically in MANUAL mode', async () => {
        const { controller, runtime, state } = await started(
            {},
            { autoEnabled: false, hostCanCompact: true }
        )
        await turn(controller, runtime, 510_000)
        expect(runtime.forks).toHaveLength(0)
        expect(state.lastDecision).toBe('MANUAL: automatic control off')
    })

    it('does nothing automatically where the host cannot compact', async () => {
        const { controller, runtime, state } = await started(
            {},
            { autoEnabled: true, hostCanCompact: false }
        )
        await turn(controller, runtime, 510_000)
        expect(runtime.forks).toHaveLength(0)
        expect(state.lastDecision).toBe(
            'OBSERVE: this session cannot run plugin compaction'
        )
        controller.setHostCanCompact(true)
        expect(controller.hostCanCompact).toBe(true)
    })

    it('waits when the fill is unknown', async () => {
        const { controller, runtime, state } = await started()
        await turn(controller, runtime, undefined)
        expect(runtime.forks).toHaveLength(0)
        expect(state.lastDecision).toBe('Context fill unknown')
    })

    it('fails loudly when the policy does not fit the window', async () => {
        const controller = controllerOf()
        const runtime = new FakeRuntime()
        runtime.context = { tokens: 350_000, window: 400_000 }
        await controller.initialize(runtime)
        await controller.onMainTurnComplete(runtime)
        expect(controller.snapshot.resolvedPolicy).toBeUndefined()
        expect(controller.snapshot.lastError).toContain('context window')
        expect(runtime.forks).toHaveLength(0)
    })

    it('warns when the host autocompact can pre-empt mandatory', async () => {
        const { controller, runtime, state } = await started()
        runtime.context = {
            ...runtime.context,
            hostAutoCompactEnabled: true,
            hostAutoCompactThreshold: 550_000,
        }
        await controller.refresh(runtime)
        expect(state.warnings).toEqual([
            'Host autocompact at 550k can pre-empt mandatory 500k (needs 100k headroom)',
        ])
        runtime.context = {
            ...runtime.context,
            hostAutoCompactThreshold: 700_000,
        }
        await controller.refresh(runtime)
        expect(state.warnings).toEqual([])
    })
})

describe('manual commands', () => {
    it('evaluate is a dry run that leaves the schedule alone', async () => {
        const { controller, runtime, state } = await started()
        runtime.replies.push(wait(1))
        await turn(controller, runtime, 300_000)
        const scheduled = state.nextProbeAt
        const probes = state.cycle.probes

        runtime.replies.push(compact('would keep X', 'switch'))
        await controller.evaluateNow(runtime)
        expect(runtime.compactions).toHaveLength(0)
        expect(state.lastDecision).toBe(
            'EVALUATE: COMPACT recommended (switch); nothing executed'
        )
        expect(state.lastDirective).toBe('would keep X')
        expect(state.nextProbeAt).toBe(scheduled)
        expect(state.cycle.probes).toBe(probes)

        runtime.replies.push(wait(999_999, 'edit'))
        await controller.evaluateNow(runtime)
        expect(state.lastDecision).toBe(
            'EVALUATE: WAIT (edit); would probe at 350k'
        )
        expect(state.telemetry.log.at(-1)?.action).toBe('evaluate')
    })

    it('evaluate reports unknown fill, unavailable forks and bad replies', async () => {
        const { controller, runtime, state } = await started()
        runtime.tokens = undefined
        await controller.evaluateNow(runtime)
        expect(state.lastDecision).toBe('EVALUATE: context fill unknown')

        runtime.tokens = 300_000
        await controller.evaluateNow(runtime)
        expect(state.lastDecision).toBe(
            'EVALUATE: fork unavailable (nothing-to-fork)'
        )

        runtime.replies.push({ kind: 'answered', text: '{}', usage: WARM })
        await controller.evaluateNow(runtime)
        expect(state.lastDecision).toBe('EVALUATE: unparseable reply')
        expect(state.telemetry.session.parseFailures).toBe(1)
    })

    it('evaluate works in MANUAL mode', async () => {
        const { controller, runtime } = await started(
            {},
            { autoEnabled: false, hostCanCompact: false }
        )
        runtime.tokens = 400_000
        runtime.replies.push(wait(1))
        await controller.evaluateNow(runtime)
        expect(runtime.decisionForks()).toHaveLength(1)
    })

    it('compact runs in MANUAL mode with one directive fork', async () => {
        const { controller, runtime, state } = await started(
            {},
            { autoEnabled: false, hostCanCompact: true }
        )
        runtime.tokens = 200_000
        runtime.replies.push(compact('manual keep'))
        await controller.compactNow(runtime)
        expect(runtime.directiveForks()[0]?.prompt).toContain('(manual)')
        expect(runtime.compactions[0]?.instructions).toContain('manual keep')
        expect(state.lastCompaction?.source).toBe('manual')
    })

    it('compact reports instead of failing where the host cannot compact', async () => {
        const { controller, runtime, state } = await started(
            {},
            { autoEnabled: true, hostCanCompact: false }
        )
        await controller.compactNow(runtime)
        expect(runtime.forks).toHaveLength(0)
        expect(runtime.compactions).toHaveLength(0)
        expect(state.lastDecision).toContain('use /compact')
    })

    it('a failed manual compaction reports without backoff', async () => {
        const { controller, runtime, state } = await started({
            forkOnMandatory: false,
        })
        runtime.compactFailures = ['throw']
        await controller.compactNow(runtime)
        expect(state.lastDecision).toBe('Manual compaction failed')
        expect(state.cycle.failures).toBe(0)
        expect(state.cycle.retryAtTurn).toBeUndefined()
    })

    it('compact refuses without a resolved policy', async () => {
        const controller = controllerOf()
        const runtime = new FakeRuntime()
        runtime.context = { tokens: 1, window: 100 }
        await controller.initialize(runtime)
        await controller.compactNow(runtime)
        expect(controller.snapshot.lastDecision).toBe(
            'Compaction refused: policy unresolved'
        )
    })
})

describe('host compactions', () => {
    it('composes native instructions with the pending directive', async () => {
        const { controller, runtime, state } = await started()
        expect(controller.nativeInstructions('  ')).toBe('BASE')

        runtime.defaultReply = () => compact('pending keep')
        runtime.compactFailures = ['skip']
        await turn(controller, runtime, 510_000)
        expect(controller.nativeInstructions('user words')).toBe(
            `user words\n\nBASE\n\n${DIRECTIVE_LABEL} pending keep`
        )
        expect(state.telemetry.session.injections).toBe(2)
    })

    it('injects nothing when injectNative is off', async () => {
        const { controller, state } = await started({ injectNative: false })
        expect(controller.nativeInstructions('x')).toBeUndefined()
        expect(state.telemetry.session.injections).toBe(0)
    })

    it('opens a new cycle after an observed host compaction', async () => {
        const { controller, runtime, state } = await started()
        runtime.replies.push(wait(1))
        await turn(controller, runtime, 300_000)
        controller.noteExternalCompaction('auto', 900_000, 40_000)
        expect(state.lastCompaction).toEqual({
            before: 900_000,
            after: 40_000,
            source: 'auto',
        })
        expect(state.lastDecision).toBe('Observed auto compaction')
        expect(state.context.tokens).toBeUndefined()
        expect(state.cycle).toMatchObject({ probes: 0, startTokens: undefined })
        expect(state.telemetry.lastCompactions(1)[0]).toMatchObject({
            source: 'auto',
            probes: 1,
        })

        await turn(controller, runtime, 60_000)
        expect(state.cycle.startTokens).toBe(60_000)
        // No delta spans the compaction.
        expect(state.growth.snapshot().samples).toBe(0)
    })

    it('falls back to the known fill when the host reports no size', async () => {
        const { controller, state } = await started({}, undefined, 123_000)
        controller.noteExternalCompaction('manual')
        expect(state.lastCompaction).toEqual({
            before: 123_000,
            after: undefined,
            source: 'manual',
        })
    })
})

describe('trial CP1–3 regressions', () => {
    it('J-007: a failure after a standing compaction is reported, never retried', async () => {
        const { controller, runtime, state } = await started({
            forkOnMandatory: false,
        })
        runtime.saveTelemetry = async () => {
            throw new Error('store failed')
        }
        await turn(controller, runtime, 510_000)
        expect(state.compactions).toBe(1)
        expect(state.cycle.pending).toBeUndefined()
        expect(state.cycle.retryAtTurn).toBeUndefined()
        expect(state.lastError).toBe('After compaction: store failed')
        await turn(controller, runtime, 60_000)
        await turn(controller, runtime, 70_000)
        expect(runtime.compactions).toHaveLength(1)
    })

    it('J-008: no growth sample spans an unknown fill or a failed refresh', async () => {
        const { controller, runtime, state } = await started({
            maxProbesPerCycle: 0,
        })
        await turn(controller, runtime, 100_000)
        await turn(controller, runtime, 110_000)
        await turn(controller, runtime, undefined)
        await turn(controller, runtime, 300_000)
        // Only the adjacent 100k → 110k pair counts.
        expect(state.growth.snapshot().samples).toBe(1)

        const read = runtime.readContext.bind(runtime)
        runtime.readContext = async () => {
            throw new Error('usage unavailable')
        }
        await controller.onMainTurnComplete(runtime)
        runtime.readContext = read
        await turn(controller, runtime, 320_000)
        await turn(controller, runtime, 330_000)
        expect(state.growth.snapshot().samples).toBe(2)
    })

    it('J-009: an answer that arrives after AUTO was switched off is discarded', async () => {
        const { controller, runtime, state } = await started()
        runtime.defaultReply = () => {
            controller.setAutoEnabled(false)
            return compact('late')
        }
        await turn(controller, runtime, 300_000)
        expect(runtime.compactions).toHaveLength(0)
        expect(state.lastDecision).toBe(
            'Discarded automatic work: the mode or cycle changed while it ran'
        )
    })

    it('J-009: an answer that arrives after host capability was lost is discarded', async () => {
        const { controller, runtime } = await started()
        runtime.defaultReply = () => {
            controller.setHostCanCompact(false)
            return compact('late')
        }
        await turn(controller, runtime, 510_000)
        expect(runtime.compactions).toHaveLength(0)
    })

    it('J-009: an answer from a cycle a host compaction ended is discarded', async () => {
        const { controller, runtime, state } = await started()
        runtime.defaultReply = () => {
            controller.noteExternalCompaction('auto', 300_000, 30_000)
            return compact('old cycle')
        }
        await turn(controller, runtime, 300_000)
        expect(runtime.compactions).toHaveLength(0)
        expect(state.cycle.probes).toBe(0)
        expect(state.cycle.forkUsage.calls).toBe(0)
        expect(state.forkUsage.calls).toBe(1)
    })

    describe('J-009: authority lost during the final invalidation', () => {
        it('AUTO switched off: no host compaction', async () => {
            const { controller, runtime, state } = await started()
            runtime.replies.push(compact('seam'))
            onCompacting(runtime, state, () => controller.setAutoEnabled(false))
            await turn(controller, runtime, 300_000)
            expect(runtime.compactions).toHaveLength(0)
            expect(state.lastDecision).toBe(
                'Discarded automatic work: the mode or cycle changed while it ran'
            )
            expect(state.mode).toBe('idle')
        })

        it('host capability lost: no host compaction', async () => {
            const { controller, runtime, state } = await started()
            onCompacting(runtime, state, () =>
                controller.setHostCanCompact(false)
            )
            await turn(controller, runtime, 510_000)
            expect(runtime.compactions).toHaveLength(0)
        })

        it('cycle ended by a host compaction: no host compaction', async () => {
            const { controller, runtime, state } = await started()
            runtime.replies.push(compact('seam'))
            onCompacting(runtime, state, () =>
                controller.noteExternalCompaction('auto', 300_000, 30_000)
            )
            await turn(controller, runtime, 300_000)
            expect(runtime.compactions).toHaveLength(0)
            expect(state.compactions).toBe(1)
        })

        it('a manual compaction is not automatic work and still runs', async () => {
            const { controller, runtime, state } = await started()
            controller.setAutoEnabled(false)
            runtime.tokens = 300_000
            onCompacting(runtime, state, () => controller.setAutoEnabled(false))
            await controller.compactNow(runtime)
            expect(runtime.compactions).toHaveLength(1)
            expect(state.lastDecision).toBe('Compacted (manual)')
        })
    })

    it('J-011: evaluate leaves an unset schedule unset', async () => {
        const { controller, runtime, state } = await started()
        controller.noteExternalCompaction('auto', 300_000, 30_000)
        runtime.tokens = 300_000
        runtime.replies.push(wait(1))
        await controller.evaluateNow(runtime)
        expect(state.nextProbeAt).toBeUndefined()
    })
})

describe('serialization', () => {
    it('runs overlapping operations one after another', async () => {
        const { controller, runtime } = await started()
        runtime.defaultReply = () => wait(1)
        runtime.tokens = 300_000
        await Promise.all([
            controller.onMainTurnComplete(runtime),
            controller.evaluateNow(runtime),
            controller.onMainTurnComplete(runtime),
        ])
        expect(controller.snapshot.turn).toBe(2)
        expect(controller.snapshot.mode).toBe('idle')
    })
})
