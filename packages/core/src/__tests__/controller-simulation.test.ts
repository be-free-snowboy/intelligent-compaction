import { describe, expect, it } from 'vitest'
import type { ForkOutcome } from '../application/ports'
import {
    COLD,
    FakeRuntime,
    WARM,
    controllerOf,
    type PolicyOverrides,
} from './support/fixtures'

/** Deterministic PRNG (mulberry32) so every run is reproducible by seed. */
function random(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

interface SimulationStats {
    compactions: Array<{ before: number; source: string; turn: number }>
    decisionForksPerCycle: number[]
    directiveForksPerAttempt: number[]
    peak: number
    meanFill: number
}

/**
 * Drives one controller through a long session: random per-turn growth with
 * spikes, random probe answers (WAIT/COMPACT/unavailable/garbage, warm or
 * cold), and random host compaction failures.
 */
async function simulate(
    seed: number,
    policy: PolicyOverrides,
    turns = 400
): Promise<SimulationStats> {
    const rand = random(seed)
    const controller = controllerOf(policy)
    const runtime = new FakeRuntime()
    runtime.tokens = 20_000
    await controller.initialize(runtime)

    runtime.defaultReply = (call): ForkOutcome => {
        const usage = rand() < 0.1 ? COLD : WARM
        const roll = rand()
        if (call.kind === 'directive')
            return roll < 0.1
                ? { kind: 'unavailable', reason: 'api-error', usage }
                : {
                      kind: 'answered',
                      text: JSON.stringify({ a: 'C', i: 'keep; it' }),
                      usage,
                  }
        if (roll < 0.05)
            return { kind: 'unavailable', reason: 'empty-reply', usage }
        if (roll < 0.08) return { kind: 'answered', text: 'garbage', usage }
        if (roll < 0.2)
            return {
                kind: 'answered',
                text: JSON.stringify({ a: 'C', i: 'seam', r: 'done' }),
                usage,
            }
        return {
            kind: 'answered',
            text: JSON.stringify({
                a: 'W',
                n: Math.round(rand() * 2_000_000),
                r: 'midphase',
            }),
            usage,
        }
    }

    const stats: SimulationStats = {
        compactions: [],
        decisionForksPerCycle: [0],
        directiveForksPerAttempt: [],
        peak: 0,
        meanFill: 0,
    }
    let fillSum = 0
    let directiveForksThisCycle = 0
    for (let t = 1; t <= turns; t += 1) {
        const spike = rand() < 0.05 ? 60_000 + rand() * 60_000 : 0
        runtime.tokens = (runtime.tokens ?? 0) + 2_000 + rand() * 25_000 + spike
        runtime.tokens = Math.round(runtime.tokens)
        runtime.after = Math.round(15_000 + rand() * 45_000)
        runtime.compactFailures = rand() < 0.1 ? ['skip'] : []

        const forksBefore = runtime.forks.length
        const compactionsBefore = runtime.compactions.length
        const directivesBefore = runtime.directiveForks().length
        const fill = runtime.tokens
        await controller.onMainTurnComplete(runtime)

        const newForks = runtime.forks.slice(forksBefore)
        stats.decisionForksPerCycle[stats.decisionForksPerCycle.length - 1]! +=
            newForks.filter((call) => call.kind === 'decision').length
        directiveForksThisCycle +=
            runtime.directiveForks().length - directivesBefore
        stats.peak = Math.max(stats.peak, fill)
        fillSum += fill

        if (runtime.compactions.length > compactionsBefore) {
            stats.compactions.push({
                before: fill,
                source: controller.snapshot.lastCompaction?.source ?? '?',
                turn: t,
            })
            stats.directiveForksPerAttempt.push(directiveForksThisCycle)
            directiveForksThisCycle = 0
            stats.decisionForksPerCycle.push(0)
        }
    }
    stats.meanFill = fillSum / turns
    return stats
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)
const BALANCED: PolicyOverrides = {}

describe('long-session invariants (ARCHITECTURE §7)', () => {
    it.each(SEEDS)(
        'seed %i: probe budget, single directive fork, arm and progress',
        async (seed) => {
            const policy = BALANCED
            const stats = await simulate(seed, policy)
            // Invariant 2: automatic probes per cycle ≤ maxProbesPerCycle (5).
            for (const probes of stats.decisionForksPerCycle)
                expect(probes).toBeLessThanOrEqual(5)
            // Invariant 3: at most one directive fork per compaction attempt chain.
            for (const forks of stats.directiveForksPerAttempt)
                expect(forks).toBeLessThanOrEqual(1)
            // Invariants 4 and 5: no compaction below arm except pre-mandatory.
            const belowArm = stats.compactions.filter(
                (compaction) => compaction.before < 300_000
            )
            expect(
                belowArm.every(
                    (compaction) => compaction.source === 'pre-mandatory'
                )
            ).toBe(true)
            expect(stats.compactions.length).toBeGreaterThan(0)
        }
    )

    it.each(SEEDS)(
        'seed %i: the fill stays far below the host window',
        async (seed) => {
            const stats = await simulate(seed, BALANCED)
            // Mandatory 500k + at most one spike turn (≤ 147k) + retry delays of
            // at most 8 turns of ≤ 27k regular growth each in this model.
            expect(stats.peak).toBeLessThan(900_000)
            expect(stats.meanFill).toBeLessThan(500_000)
        }
    )

    it('a zero probe budget never forks a decision', async () => {
        for (const seed of SEEDS.slice(0, 10)) {
            const stats = await simulate(seed, { maxProbesPerCycle: 0 })
            expect(stats.decisionForksPerCycle.every((n) => n === 0)).toBe(true)
        }
    })

    it('economy thresholds lower the mean fill', async () => {
        let balanced = 0
        let economy = 0
        for (const seed of SEEDS) {
            balanced += (await simulate(seed, BALANCED)).meanFill
            economy += (
                await simulate(seed, { arm: 200_000, mandatory: 400_000 })
            ).meanFill
        }
        expect(economy).toBeLessThan(balanced)
    })
})

describe('probe cost accounting', () => {
    it('cold forks suspend probing within the cycle', async () => {
        const controller = controllerOf()
        const runtime = new FakeRuntime()
        runtime.tokens = 20_000
        await controller.initialize(runtime)
        runtime.defaultReply = (call) =>
            call.kind === 'decision'
                ? { kind: 'answered', text: '{"a":"W","n":1}', usage: COLD }
                : { kind: 'answered', text: '{"a":"C","i":"x"}', usage: WARM }
        let decisions = 0
        for (let fill = 300_000; fill <= 470_000; fill += 10_000) {
            runtime.tokens = fill
            await controller.onMainTurnComplete(runtime)
            decisions = runtime.decisionForks().length
        }
        expect(decisions).toBe(2)
        expect(controller.snapshot.cycle.suspended).toBe('cache')
    })
})
