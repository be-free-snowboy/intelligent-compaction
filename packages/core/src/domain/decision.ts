/** Seam reasons the probe may give for COMPACT. */
export const COMPACT_REASONS = ['done', 'green', 'plan', 'switch'] as const
/** Live-state reasons the probe may give for WAIT. */
export const WAIT_REASONS = ['debug', 'edit', 'question', 'midphase'] as const

export type ProbeReason =
    | (typeof COMPACT_REASONS)[number]
    | (typeof WAIT_REASONS)[number]
    | 'other'

export interface WaitDecision {
    readonly action: 'wait'
    readonly requestedNextProbeAt: number
    readonly reason: ProbeReason
}

export interface CompactDecision {
    readonly action: 'compact'
    readonly directive: string
    readonly reason: ProbeReason
}

export type ProbeDecision = WaitDecision | CompactDecision

const KNOWN_REASONS: ReadonlySet<string> = new Set([
    ...COMPACT_REASONS,
    ...WAIT_REASONS,
])

/**
 * Cuts a directive to `maxChars`. Items are ordered most important first and
 * separated by `; `, so a cut falls back to the last whole item; text with no
 * separator inside the budget is cut at the budget.
 */
export function truncateDirective(directive: string, maxChars: number): string {
    const text = directive.trim()
    if (text.length <= maxChars) return text
    const cut = text.slice(0, maxChars)
    const boundary = cut.lastIndexOf('; ')
    return (boundary > 0 ? cut.slice(0, boundary) : cut).trim()
}

export class ProbeDecisionParser {
    parse(text: string, directiveMaxChars: number): ProbeDecision {
        const raw = this.parseObject(text)
        const reason = this.reason(raw.r)
        if (raw.a === 'W') {
            const next = typeof raw.n === 'number' ? raw.n : Number(raw.n)
            if (!Number.isFinite(next))
                throw new Error('WAIT decision requires numeric n')
            return {
                action: 'wait',
                requestedNextProbeAt: Math.round(next),
                reason,
            }
        }
        if (raw.a === 'C') {
            const directive = typeof raw.i === 'string' ? raw.i : ''
            return {
                action: 'compact',
                directive: truncateDirective(directive, directiveMaxChars),
                reason,
            }
        }
        throw new Error('Probe decision must use a=W or a=C')
    }

    private parseObject(text: string): Record<string, unknown> {
        const start = text.indexOf('{')
        const end = text.lastIndexOf('}')
        if (start < 0 || end < start)
            throw new Error('Probe reply did not contain a JSON object')
        // A valid JSON text that opens with { and closes with } is an object.
        return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    }

    private reason(value: unknown): ProbeReason {
        return typeof value === 'string' && KNOWN_REASONS.has(value)
            ? (value as ProbeReason)
            : 'other'
    }
}

export interface ProbeBoundsInput {
    readonly tokens: number
    readonly mandatory: number
    readonly minGap: number
    readonly maxGap: number
    readonly meanDelta?: number | undefined
    readonly p90Delta?: number | undefined
}

export interface ProbeBounds {
    readonly lower: number
    readonly upper: number
}

/** Multiplier from mean turn growth to the effective minimum probe gap. */
export const GROWTH_GAP_MULTIPLIER = 3
/** p90 turns of headroom the next probe keeps before mandatory. */
export const MANDATORY_GUARD_TURNS = 2

export class ProbeScheduler {
    /**
     * The window the next probe may land in: at least one growth-aware gap
     * away, at most `maxGap` away, never closer to mandatory than two p90 turns.
     */
    bounds(input: ProbeBoundsInput): ProbeBounds {
        const gap = Math.min(
            input.maxGap,
            Math.max(
                input.minGap,
                GROWTH_GAP_MULTIPLIER * (input.meanDelta ?? 0)
            )
        )
        // Within two p90 turns of mandatory the cap meets the fill: the next
        // probe is due at the next turn, a last seam check before pressure.
        const cap = Math.max(
            input.tokens,
            input.mandatory - MANDATORY_GUARD_TURNS * (input.p90Delta ?? 0)
        )
        return {
            lower: Math.min(cap, input.tokens + gap),
            upper: Math.min(cap, input.tokens + input.maxGap),
        }
    }

    clamp(requested: number, bounds: ProbeBounds): number {
        return Math.max(
            bounds.lower,
            Math.min(bounds.upper, Math.round(requested))
        )
    }
}
