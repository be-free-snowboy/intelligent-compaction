import { describe, expect, it } from 'vitest'
import {
    COMPACTION_RECORD_LIMIT,
    DECISION_LOG_LIMIT,
    GROWTH_AFTER_TURNS,
    Telemetry,
    TELEMETRY_VERSION,
    type CompactionTelemetry,
} from '../domain/telemetry'

const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }

function record(before = 500): CompactionTelemetry {
    return {
        source: 'semantic',
        before,
        after: 30,
        probes: 2,
        forkUsage: usage,
        directiveChars: 12,
    }
}

describe('Telemetry', () => {
    it('counts in the session and the lifetime', () => {
        const telemetry = new Telemetry()
        telemetry.count('probes')
        telemetry.count('probes')
        telemetry.resetSession()
        telemetry.count('probes')
        expect(telemetry.session.probes).toBe(1)
        expect(telemetry.lifetimeCounters().probes).toBe(3)
    })

    it('accumulates reasons and fork usage', () => {
        const telemetry = new Telemetry()
        telemetry.reason('done')
        telemetry.reason('done')
        telemetry.forkUsage(usage)
        telemetry.forkUsage(usage)
        const data = telemetry.toData()
        expect(data.reasons).toEqual({ done: 2 })
        expect(data.forkUsage).toEqual({
            input: 2,
            output: 4,
            cacheRead: 6,
            cacheWrite: 8,
        })
    })

    it('bounds the decision log', () => {
        const telemetry = new Telemetry()
        for (let turn = 0; turn < DECISION_LOG_LIMIT + 5; turn += 1)
            telemetry.logDecision({ turn, tokens: turn, action: 'wait' })
        expect(telemetry.log).toHaveLength(DECISION_LOG_LIMIT)
        expect(telemetry.log[0]?.turn).toBe(5)
    })

    it('bounds compaction records and counts them', () => {
        const telemetry = new Telemetry()
        for (let i = 0; i < COMPACTION_RECORD_LIMIT + 1; i += 1)
            telemetry.recordCompaction(record(i))
        expect(telemetry.toData().compactions).toHaveLength(
            COMPACTION_RECORD_LIMIT
        )
        expect(telemetry.lastCompactions(1)[0]?.before).toBe(
            COMPACTION_RECORD_LIMIT
        )
        expect(telemetry.session.compactions).toBe(COMPACTION_RECORD_LIMIT + 1)
    })

    it('sums growth over the turns after a compaction', () => {
        const telemetry = new Telemetry()
        telemetry.observeGrowth(999)
        telemetry.recordCompaction(record())
        for (let i = 1; i <= GROWTH_AFTER_TURNS + 1; i += 1)
            telemetry.observeGrowth(i * 10)
        expect(telemetry.lastCompactions(1)[0]?.growthAfter).toBe(60)
    })

    it('J-006: keeps overlapping post-compaction windows apart', () => {
        const telemetry = new Telemetry()
        telemetry.recordCompaction(record(1))
        telemetry.observeGrowth(10)
        telemetry.recordCompaction(record(2))
        telemetry.observeGrowth(20)
        telemetry.observeGrowth(30)
        telemetry.observeGrowth(40)
        const [a, b] = telemetry.lastCompactions(2)
        expect(a?.growthAfter).toBe(60)
        expect(b?.growthAfter).toBe(90)
    })

    it('J-010: keeps a session reason histogram beside the lifetime one', () => {
        const telemetry = new Telemetry()
        telemetry.reason('done')
        telemetry.resetSession()
        telemetry.reason('debug')
        expect(telemetry.sessionReasons).toEqual({ debug: 1 })
        expect(telemetry.toData().reasons).toEqual({ done: 1, debug: 1 })
    })

    it('round-trips stored data and replaces anything unrecognized', () => {
        const telemetry = new Telemetry()
        telemetry.count('waits')
        telemetry.recordCompaction(record())
        const stored = JSON.parse(JSON.stringify(telemetry.toData())) as unknown

        const restored = new Telemetry()
        restored.load(stored)
        expect(restored.toData()).toEqual(telemetry.toData())

        for (const corrupt of [
            undefined,
            'x',
            { version: TELEMETRY_VERSION + 1 },
            { ...(stored as object), counters: { waits: -1 } },
            { ...(stored as object), compactions: [{ source: 1 }] },
            { ...(stored as object), reasons: { done: 'x' } },
        ]) {
            const fresh = new Telemetry()
            fresh.load(corrupt)
            expect(fresh.toData().counters.waits).toBe(0)
            expect(fresh.toData().compactions).toEqual([])
        }
    })

    it('hands out copies, not its own data', () => {
        const telemetry = new Telemetry()
        telemetry.toData().counters.probes = 99
        expect(telemetry.lifetimeCounters().probes).toBe(0)
    })
})
