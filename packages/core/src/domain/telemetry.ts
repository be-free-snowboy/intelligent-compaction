import type { ProbeReason } from './decision'
import type { ForkUsage } from './state'

export const TELEMETRY_VERSION = 1
/** Decisions kept in the session log. */
export const DECISION_LOG_LIMIT = 50
/** Compaction records kept across sessions. */
export const COMPACTION_RECORD_LIMIT = 100
/** Main turns after a compaction whose growth is summed into `growthAfter`. */
export const GROWTH_AFTER_TURNS = 3

export interface TelemetryCounters {
    probes: number
    waits: number
    compactDecisions: number
    compactions: number
    parseFailures: number
    forkUnavailable: number
    budgetExhausted: number
    cacheTrips: number
    backoffs: number
    injections: number
}

export type TelemetryCounter = keyof TelemetryCounters

export interface CompactionTelemetry {
    readonly source: string
    readonly before: number
    readonly after?: number | undefined
    readonly probes: number
    readonly forkUsage: ForkUsage
    readonly directiveChars: number
    growthAfter?: number | undefined
}

export interface TelemetryData {
    readonly version: number
    readonly counters: TelemetryCounters
    readonly reasons: Record<string, number>
    readonly forkUsage: ForkUsage
    readonly compactions: CompactionTelemetry[]
}

export type DecisionAction =
    | 'wait'
    | 'compact'
    | 'unavailable'
    | 'unparseable'
    | 'directive'
    | 'evaluate'

export interface DecisionLogEntry {
    readonly turn: number
    readonly tokens: number
    readonly action: DecisionAction
    readonly reason?: ProbeReason | undefined
    readonly cacheRatio?: number | undefined
    readonly usage?: ForkUsage | undefined
}

/** An open growth span, its record named by its distance from the newest. */
export interface GrowthSpanData {
    readonly offset: number
    readonly remaining: number
    readonly sum: number
}

/** The session's telemetry, with the lifetime data it may not have stored yet. */
export interface TelemetrySessionData {
    readonly counters: TelemetryCounters
    readonly reasons: Record<string, number>
    readonly log: readonly DecisionLogEntry[]
    readonly spans: readonly GrowthSpanData[]
    readonly lifetime: TelemetryData
}

const DECISION_ACTIONS: ReadonlySet<string> = new Set<DecisionAction>([
    'wait',
    'compact',
    'unavailable',
    'unparseable',
    'directive',
    'evaluate',
])

function zeroCounters(): TelemetryCounters {
    return {
        probes: 0,
        waits: 0,
        compactDecisions: 0,
        compactions: 0,
        parseFailures: 0,
        forkUnavailable: 0,
        budgetExhausted: 0,
        cacheTrips: 0,
        backoffs: 0,
        injections: 0,
    }
}

function zeroUsage(): ForkUsage {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function freshData(): TelemetryData {
    return {
        version: TELEMETRY_VERSION,
        counters: zeroCounters(),
        reasons: {},
        forkUsage: zeroUsage(),
        compactions: [],
    }
}

/**
 * Session and lifetime evidence for tuning policies. Telemetry observes the
 * control loop; it never steers it.
 */
interface GrowthSpan {
    readonly record: CompactionTelemetry
    remaining: number
    sum: number
}

export class Telemetry {
    session: TelemetryCounters = zeroCounters()
    sessionReasons: Record<string, number> = {}
    log: DecisionLogEntry[] = []
    private lifetime: TelemetryData = freshData()
    /** One open span per compaction still collecting its `growthAfter`. */
    private growthSpans: GrowthSpan[] = []

    /** Adopts stored data; anything unrecognized starts fresh. */
    load(raw: unknown): void {
        this.lifetime = isTelemetryData(raw) ? raw : freshData()
    }

    count(counter: TelemetryCounter): void {
        this.session[counter] += 1
        this.lifetime.counters[counter] += 1
    }

    reason(reason: ProbeReason): void {
        this.sessionReasons[reason] = (this.sessionReasons[reason] ?? 0) + 1
        this.lifetime.reasons[reason] = (this.lifetime.reasons[reason] ?? 0) + 1
    }

    forkUsage(usage: ForkUsage): void {
        const total = this.lifetime.forkUsage
        this.lifetime = {
            ...this.lifetime,
            forkUsage: {
                input: total.input + usage.input,
                output: total.output + usage.output,
                cacheRead: total.cacheRead + usage.cacheRead,
                cacheWrite: total.cacheWrite + usage.cacheWrite,
            },
        }
    }

    logDecision(entry: DecisionLogEntry): void {
        this.log.push(entry)
        if (this.log.length > DECISION_LOG_LIMIT) this.log.shift()
    }

    recordCompaction(record: CompactionTelemetry): void {
        this.count('compactions')
        const stored = { ...record }
        this.lifetime.compactions.push(stored)
        if (this.lifetime.compactions.length > COMPACTION_RECORD_LIMIT)
            this.lifetime.compactions.shift()
        this.growthSpans.push({
            record: stored,
            remaining: GROWTH_AFTER_TURNS,
            sum: 0,
        })
    }

    /** Feeds one main-turn delta into every open post-compaction span. */
    observeGrowth(delta: number): void {
        for (const span of this.growthSpans) {
            span.sum += delta
            span.remaining -= 1
            if (span.remaining === 0) span.record.growthAfter = span.sum
        }
        this.growthSpans = this.growthSpans.filter((span) => span.remaining > 0)
    }

    lastCompactions(count: number): readonly CompactionTelemetry[] {
        return this.lifetime.compactions.slice(-count)
    }

    lifetimeCounters(): Readonly<TelemetryCounters> {
        return this.lifetime.counters
    }

    toData(): TelemetryData {
        return JSON.parse(JSON.stringify(this.lifetime)) as TelemetryData
    }

    toSessionData(): TelemetrySessionData {
        const records = this.lifetime.compactions
        return {
            counters: { ...this.session },
            reasons: { ...this.sessionReasons },
            log: [...this.log],
            spans: this.growthSpans.flatMap((span) => {
                const index = records.indexOf(span.record)
                return index < 0
                    ? []
                    : [
                          {
                              offset: records.length - index,
                              remaining: span.remaining,
                              sum: span.sum,
                          },
                      ]
            }),
            lifetime: this.toData(),
        }
    }

    /** Adopts carried session data; false, changing nothing, when it is malformed. */
    loadSession(raw: unknown): boolean {
        if (!isTelemetrySessionData(raw)) return false
        const lifetime = JSON.parse(
            JSON.stringify(raw.lifetime)
        ) as TelemetryData
        this.lifetime = lifetime
        this.session = { ...raw.counters }
        this.sessionReasons = { ...raw.reasons }
        this.log = raw.log.slice(-DECISION_LOG_LIMIT)
        this.growthSpans = raw.spans.flatMap((span) => {
            const record = lifetime.compactions.at(-span.offset)
            return record
                ? [{ record, remaining: span.remaining, sum: span.sum }]
                : []
        })
        return true
    }

    resetSession(): void {
        this.session = zeroCounters()
        this.sessionReasons = {}
        this.log = []
        this.growthSpans = []
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isUsage(value: unknown): value is ForkUsage {
    return (
        isRecord(value) &&
        isCount(value.input) &&
        isCount(value.output) &&
        isCount(value.cacheRead) &&
        isCount(value.cacheWrite)
    )
}

function isCompaction(value: unknown): value is CompactionTelemetry {
    return (
        isRecord(value) &&
        typeof value.source === 'string' &&
        isCount(value.before) &&
        (value.after === undefined || isCount(value.after)) &&
        isCount(value.probes) &&
        isUsage(value.forkUsage) &&
        isCount(value.directiveChars) &&
        (value.growthAfter === undefined || isCount(value.growthAfter))
    )
}

function isCounters(value: unknown): value is TelemetryCounters {
    return (
        isRecord(value) &&
        Object.keys(zeroCounters()).every((key) => isCount(value[key]))
    )
}

function isReasons(value: unknown): value is Record<string, number> {
    return isRecord(value) && Object.values(value).every(isCount)
}

function isLogEntry(value: unknown): value is DecisionLogEntry {
    return (
        isRecord(value) &&
        isCount(value.turn) &&
        isCount(value.tokens) &&
        typeof value.action === 'string' &&
        DECISION_ACTIONS.has(value.action) &&
        (value.reason === undefined || typeof value.reason === 'string') &&
        (value.cacheRatio === undefined ||
            typeof value.cacheRatio === 'number') &&
        (value.usage === undefined || isUsage(value.usage))
    )
}

function isSpan(value: unknown): value is GrowthSpanData {
    return (
        isRecord(value) &&
        isCount(value.offset) &&
        value.offset > 0 &&
        isCount(value.remaining) &&
        isCount(value.sum)
    )
}

export function isTelemetrySessionData(
    value: unknown
): value is TelemetrySessionData {
    return (
        isRecord(value) &&
        isCounters(value.counters) &&
        isReasons(value.reasons) &&
        Array.isArray(value.log) &&
        value.log.every(isLogEntry) &&
        Array.isArray(value.spans) &&
        value.spans.every(isSpan) &&
        isTelemetryData(value.lifetime)
    )
}

function isTelemetryData(value: unknown): value is TelemetryData {
    if (!isRecord(value) || value.version !== TELEMETRY_VERSION) return false
    return (
        isCounters(value.counters) &&
        isReasons(value.reasons) &&
        isUsage(value.forkUsage) &&
        Array.isArray(value.compactions) &&
        value.compactions.length <= COMPACTION_RECORD_LIMIT &&
        value.compactions.every(isCompaction)
    )
}
