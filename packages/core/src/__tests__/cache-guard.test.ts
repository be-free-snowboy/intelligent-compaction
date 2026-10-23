import { describe, expect, it } from 'vitest'
import { CacheGuard, cacheReadRatio } from '../domain/cache-guard'

const warm = { input: 10, output: 5, cacheRead: 90, cacheWrite: 0 }
const cold = { input: 90, output: 5, cacheRead: 0, cacheWrite: 10 }

describe('cacheReadRatio', () => {
    it('divides cache reads by all input tokens', () => {
        expect(cacheReadRatio(warm)).toBe(0.9)
        expect(cacheReadRatio(cold)).toBe(0)
    })

    it('is undefined without input', () => {
        expect(
            cacheReadRatio({ input: 0, output: 3, cacheRead: 0, cacheWrite: 0 })
        ).toBeUndefined()
    })
})

describe('CacheGuard', () => {
    it('needs two samples before it can trip', () => {
        const guard = new CacheGuard()
        guard.record(cold)
        expect(guard.isTripped(0.7)).toBe(false)
        guard.record(cold)
        expect(guard.isTripped(0.7)).toBe(true)
    })

    it('averages only the last three samples', () => {
        const guard = new CacheGuard()
        guard.record(cold)
        guard.record(warm)
        guard.record(warm)
        guard.record(warm)
        expect(guard.mean()).toBeCloseTo(0.9)
        expect(guard.isTripped(0.7)).toBe(false)
    })

    it('trips when the mean falls below the floor', () => {
        const guard = new CacheGuard()
        guard.record(warm)
        guard.record(cold)
        expect(guard.mean()).toBeCloseTo(0.45)
        expect(guard.isTripped(0.7)).toBe(true)
        expect(guard.isTripped(0.4)).toBe(false)
    })

    it('skips usage without input and resets', () => {
        const guard = new CacheGuard()
        expect(
            guard.record({ input: 0, output: 1, cacheRead: 0, cacheWrite: 0 })
        ).toBeUndefined()
        expect(guard.mean()).toBeUndefined()
        guard.record(cold)
        guard.record(cold)
        guard.reset()
        expect(guard.isTripped(0.7)).toBe(false)
    })
})
