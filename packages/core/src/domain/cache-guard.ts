import type { ForkUsage } from './state'

/** Most recent probe samples the guard averages. */
export const CACHE_WINDOW = 3
/** Samples required before the guard may trip. */
export const CACHE_MIN_SAMPLES = 2

/** Share of a fork's input that the main thread's prompt cache served. */
export function cacheReadRatio(usage: ForkUsage): number | undefined {
    const total = usage.input + usage.cacheRead + usage.cacheWrite
    return total > 0 ? usage.cacheRead / total : undefined
}

/**
 * Suspends probing when forks stop reading the main thread's cache: a cold
 * probe pays the whole transcript prefix and erases the saving it protects.
 */
export class CacheGuard {
    private samples: number[] = []

    /** Records a probe's usage; returns its ratio when one is defined. */
    record(usage: ForkUsage): number | undefined {
        const ratio = cacheReadRatio(usage)
        if (ratio === undefined) return undefined
        this.samples.push(ratio)
        if (this.samples.length > CACHE_WINDOW) this.samples.shift()
        return ratio
    }

    mean(): number | undefined {
        if (this.samples.length === 0) return undefined
        const sum = this.samples.reduce((total, ratio) => total + ratio, 0)
        return sum / this.samples.length
    }

    isTripped(floor: number): boolean {
        const mean = this.mean()
        return (
            this.samples.length >= CACHE_MIN_SAMPLES &&
            mean !== undefined &&
            mean < floor
        )
    }

    reset(): void {
        this.samples = []
    }

    toData(): number[] {
        return [...this.samples]
    }

    load(samples: readonly number[]): void {
        this.samples = samples.slice(-CACHE_WINDOW)
    }
}
