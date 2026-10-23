import { describe, expect, it } from 'vitest'
import { GROWTH_WINDOW, GrowthTracker } from '../domain/growth'

function tracked(...fills: number[]): GrowthTracker {
    const tracker = new GrowthTracker()
    for (const fill of fills) tracker.observe(fill)
    return tracker
}

describe('GrowthTracker', () => {
    it('records deltas between consecutive turn ends', () => {
        const tracker = new GrowthTracker()
        expect(tracker.observe(100)).toBeUndefined()
        expect(tracker.observe(130)).toBe(30)
        expect(tracker.snapshot().samples).toBe(1)
    })

    it('ignores negative deltas but moves the baseline', () => {
        const tracker = tracked(100, 50)
        expect(tracker.snapshot().samples).toBe(0)
        expect(tracker.observe(80)).toBe(30)
    })

    it('defines mean and p90 only from three samples', () => {
        const tracker = tracked(0, 10, 30)
        expect(tracker.mean()).toBeUndefined()
        expect(tracker.p90()).toBeUndefined()
        tracker.observe(60)
        expect(tracker.mean()).toBe(20)
        expect(tracker.p90()).toBe(30)
    })

    it('uses the nearest-rank 90th percentile', () => {
        const fills = [0]
        for (let i = 1; i <= 10; i += 1) fills.push(fills[i - 1]! + i * 10)
        expect(tracked(...fills).p90()).toBe(90)
    })

    it('keeps only the last window of deltas', () => {
        const fills = [0, 1000]
        for (let i = 0; i < GROWTH_WINDOW; i += 1)
            fills.push(fills[fills.length - 1]! + 1)
        const tracker = tracked(...fills)
        expect(tracker.snapshot().samples).toBe(GROWTH_WINDOW)
        expect(tracker.mean()).toBe(1)
    })

    it('rebases after a compaction instead of counting the drop', () => {
        const tracker = tracked(0, 10, 20, 30)
        tracker.rebase(5)
        expect(tracker.observe(15)).toBe(10)
        tracker.rebase(undefined)
        expect(tracker.observe(40)).toBeUndefined()
    })

    it('reset forgets samples and baseline', () => {
        const tracker = tracked(0, 10, 20, 30)
        tracker.reset()
        expect(tracker.snapshot()).toEqual({
            samples: 0,
            mean: undefined,
            p90: undefined,
        })
        expect(tracker.observe(10)).toBeUndefined()
    })
})
