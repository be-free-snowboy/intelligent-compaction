/** Main-turn deltas kept for the growth estimate. */
export const GROWTH_WINDOW = 20
/** Samples required before mean and p90 are defined. */
export const GROWTH_MIN_SAMPLES = 3

export interface GrowthSnapshot {
    readonly samples: number
    readonly mean?: number | undefined
    readonly p90?: number | undefined
}

/** The tracker's raw samples, carried across a plugin reload. */
export interface GrowthData {
    readonly deltas: readonly number[]
    readonly baseline?: number | undefined
}

/**
 * Per-turn context growth of the main thread. A delta is the change in fill
 * between two consecutive main-turn ends with no compaction in between.
 */
export class GrowthTracker {
    private deltas: number[] = []
    private baseline: number | undefined

    /** Records the turn-end fill; returns the delta it added, if any. */
    observe(tokens: number): number | undefined {
        const previous = this.baseline
        this.baseline = tokens
        if (previous === undefined) return undefined
        const delta = tokens - previous
        if (delta < 0) return undefined
        this.deltas.push(delta)
        if (this.deltas.length > GROWTH_WINDOW) this.deltas.shift()
        return delta
    }

    /** Restarts delta measurement from a fill known after a compaction. */
    rebase(tokens: number | undefined): void {
        this.baseline = tokens
    }

    reset(): void {
        this.deltas = []
        this.baseline = undefined
    }

    toData(): GrowthData {
        return { deltas: [...this.deltas], baseline: this.baseline }
    }

    load(data: GrowthData): void {
        this.deltas = data.deltas.slice(-GROWTH_WINDOW)
        this.baseline = data.baseline
    }

    mean(): number | undefined {
        if (this.deltas.length < GROWTH_MIN_SAMPLES) return undefined
        const sum = this.deltas.reduce((total, delta) => total + delta, 0)
        return Math.round(sum / this.deltas.length)
    }

    /** Nearest-rank 90th percentile. */
    p90(): number | undefined {
        if (this.deltas.length < GROWTH_MIN_SAMPLES) return undefined
        const sorted = this.deltas.toSorted((a, b) => a - b)
        return sorted[Math.ceil(sorted.length * 0.9) - 1]
    }

    snapshot(): GrowthSnapshot {
        return {
            samples: this.deltas.length,
            mean: this.mean(),
            p90: this.p90(),
        }
    }
}
