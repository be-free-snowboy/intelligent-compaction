import { CacheGuard } from './cache-guard'
import { COMPACT_REASONS, WAIT_REASONS, type ProbeReason } from './decision'
import { GrowthTracker, type GrowthData } from './growth'
import type { ResolvedPolicy } from './policy'
import {
    Telemetry,
    isTelemetrySessionData,
    type TelemetrySessionData,
} from './telemetry'

export interface ContextSnapshot {
    readonly tokens?: number | undefined
    readonly window: number
    readonly percent?: number | undefined
    readonly hostAutoCompactThreshold?: number | undefined
    readonly hostAutoCompactEnabled?: boolean | undefined
}

/**
 * Host-neutral fork usage. Adapters map their provider-specific token fields
 * into this shape at the runtime boundary.
 */
export interface ForkUsage {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
}

export interface ForkUsageTotals {
    calls: number
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
}

export interface CompactionRecord {
    readonly before: number
    readonly after?: number | undefined
    readonly source: string
}

export type ControllerMode = 'idle' | 'probing' | 'compacting'

/** Why probing is held until the next compaction. */
export type ProbeSuspension = 'budget' | 'cache'

/** What started one of the plugin's own compactions. */
export type CompactionSource =
    | 'semantic'
    | 'mandatory'
    | 'pre-mandatory'
    | 'manual'

/** An automatic compaction that skipped or threw and waits for its retry turn. */
export interface PendingAttempt {
    readonly source: CompactionSource
    /** Possibly empty; a retry reuses it and never forks again. */
    readonly directive: string
}

/** State that lives from one compaction (or session start) to the next. */
export interface CycleState {
    probes: number
    forkUsage: ForkUsageTotals
    /** Fill right after the compaction that opened the cycle. */
    startTokens?: number | undefined
    suspended?: ProbeSuspension | undefined
    pending?: PendingAttempt | undefined
    failures: number
    retryAtTurn?: number | undefined
}

export const SESSION_CARRY_VERSION = 1

/**
 * The session's control state as JSON, carried across a reload of the plugin
 * (a settings change reloads it). The context fill is left out: it is read
 * again. An in-flight probe or compaction ends with the old copy.
 */
export interface SessionCarry {
    readonly version: number
    readonly sessionId: string
    readonly nextProbeAt?: number | undefined
    readonly lastDecision: string
    readonly lastReason?: ProbeReason | undefined
    readonly lastDirective: string
    readonly turn: number
    readonly lastCompaction?: CompactionRecord | undefined
    readonly compactions: number
    readonly cycle: CycleState
    readonly growth: GrowthData
    readonly cache: readonly number[]
    readonly forkUsage: ForkUsageTotals
    readonly telemetry: TelemetrySessionData
    /** The controller's: the next turn end supplies the cycle's start fill. */
    readonly needsCycleBaseline: boolean
}

function zeroTotals(): ForkUsageTotals {
    return { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function freshCycle(startTokens?: number | undefined): CycleState {
    return { probes: 0, forkUsage: zeroTotals(), startTokens, failures: 0 }
}

function addUsage(totals: ForkUsageTotals, usage: ForkUsage): void {
    totals.calls += 1
    totals.input += usage.input
    totals.output += usage.output
    totals.cacheRead += usage.cacheRead
    totals.cacheWrite += usage.cacheWrite
}

export class ContextPilotState {
    sessionId?: string | undefined
    context: ContextSnapshot = { window: 0 }
    resolvedPolicy?: ResolvedPolicy | undefined
    nextProbeAt?: number | undefined
    lastDecision = 'Not evaluated'
    lastReason?: ProbeReason | undefined
    lastDirective = ''
    lastError?: string | undefined
    warnings: string[] = []
    mode: ControllerMode = 'idle'
    /** Main turns evaluated in this session. */
    turn = 0
    lastCompaction?: CompactionRecord | undefined
    compactions = 0
    cycle: CycleState = freshCycle()
    readonly growth = new GrowthTracker()
    readonly cache = new CacheGuard()
    /** Survives session resets: lifetime data is the adapter's to load and save. */
    readonly telemetry = new Telemetry()
    readonly forkUsage: ForkUsageTotals = zeroTotals()

    reset(sessionId?: string | undefined): void {
        this.sessionId = sessionId
        this.context = { window: 0 }
        this.resolvedPolicy = undefined
        this.nextProbeAt = undefined
        this.lastDecision = 'Not evaluated'
        this.lastReason = undefined
        this.lastDirective = ''
        this.lastError = undefined
        this.warnings = []
        this.mode = 'idle'
        this.turn = 0
        this.lastCompaction = undefined
        this.compactions = 0
        this.cycle = freshCycle()
        this.growth.reset()
        this.cache.reset()
        this.telemetry.resetSession()
        Object.assign(this.forkUsage, zeroTotals())
    }

    /** Opens a new cycle after a compaction that left `after` tokens. */
    startCycle(after?: number | undefined): void {
        this.cycle = freshCycle(after)
        this.cache.reset()
        this.nextProbeAt = undefined
        this.growth.rebase(after)
    }

    /** Session and lifetime totals, plus the cycle the fork was asked in. */
    recordForkUsage(usage: ForkUsage, cycle: CycleState = this.cycle): void {
        addUsage(this.forkUsage, usage)
        addUsage(cycle.forkUsage, usage)
        this.telemetry.forkUsage(usage)
    }

    toCarry(needsCycleBaseline: boolean): SessionCarry | undefined {
        if (this.sessionId === undefined) return undefined
        return JSON.parse(
            JSON.stringify({
                version: SESSION_CARRY_VERSION,
                sessionId: this.sessionId,
                nextProbeAt: this.nextProbeAt,
                lastDecision: this.lastDecision,
                lastReason: this.lastReason,
                lastDirective: this.lastDirective,
                turn: this.turn,
                lastCompaction: this.lastCompaction,
                compactions: this.compactions,
                cycle: this.cycle,
                growth: this.growth.toData(),
                cache: this.cache.toData(),
                forkUsage: this.forkUsage,
                telemetry: this.telemetry.toSessionData(),
                needsCycleBaseline,
            } satisfies SessionCarry)
        ) as SessionCarry
    }

    /**
     * Takes up a carry of session `sessionId`; false, leaving the state as it
     * was, for another session's carry or a malformed one.
     */
    restore(raw: unknown, sessionId: string | undefined): boolean {
        if (!isCarry(raw) || raw.sessionId !== sessionId) return false
        this.reset(sessionId)
        this.telemetry.loadSession(raw.telemetry)
        this.nextProbeAt = raw.nextProbeAt
        this.lastDecision = raw.lastDecision
        this.lastReason = raw.lastReason
        this.lastDirective = raw.lastDirective
        this.turn = raw.turn
        this.lastCompaction = raw.lastCompaction
        this.compactions = raw.compactions
        this.cycle = structuredClone(raw.cycle)
        this.growth.load(raw.growth)
        this.cache.load(raw.cache)
        Object.assign(this.forkUsage, raw.forkUsage)
        return true
    }

    cacheReadRatio(): number | undefined {
        const total =
            this.forkUsage.input +
            this.forkUsage.cacheRead +
            this.forkUsage.cacheWrite
        return total > 0 ? this.forkUsage.cacheRead / total : undefined
    }
}

const PROBE_REASONS: ReadonlySet<string> = new Set([
    ...COMPACT_REASONS,
    ...WAIT_REASONS,
    'other',
])
const COMPACTION_SOURCES: ReadonlySet<string> = new Set<CompactionSource>([
    'semantic',
    'mandatory',
    'pre-mandatory',
    'manual',
])

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isOptional(
    value: unknown,
    check: (value: unknown) => boolean
): boolean {
    return value === undefined || check(value)
}

function isTotals(value: unknown): value is ForkUsageTotals {
    return (
        isRecord(value) &&
        ['calls', 'input', 'output', 'cacheRead', 'cacheWrite'].every((key) =>
            isCount(value[key])
        )
    )
}

function isCycle(value: unknown): value is CycleState {
    if (!isRecord(value)) return false
    const pending = value.pending
    return (
        isCount(value.probes) &&
        isTotals(value.forkUsage) &&
        isOptional(value.startTokens, isCount) &&
        isOptional(value.suspended, (v) => v === 'budget' || v === 'cache') &&
        isOptional(
            pending,
            (v) =>
                isRecord(v) &&
                typeof v.source === 'string' &&
                COMPACTION_SOURCES.has(v.source) &&
                typeof v.directive === 'string'
        ) &&
        isCount(value.failures) &&
        isOptional(value.retryAtTurn, isCount)
    )
}

function isCompactionRecord(value: unknown): value is CompactionRecord {
    return (
        isRecord(value) &&
        isCount(value.before) &&
        isOptional(value.after, isCount) &&
        typeof value.source === 'string'
    )
}

function isGrowth(value: unknown): value is GrowthData {
    return (
        isRecord(value) &&
        Array.isArray(value.deltas) &&
        value.deltas.every(isCount) &&
        isOptional(value.baseline, isCount)
    )
}

function isCarry(value: unknown): value is SessionCarry {
    return (
        isRecord(value) &&
        value.version === SESSION_CARRY_VERSION &&
        typeof value.sessionId === 'string' &&
        isOptional(value.nextProbeAt, isCount) &&
        typeof value.lastDecision === 'string' &&
        isOptional(
            value.lastReason,
            (v) => typeof v === 'string' && PROBE_REASONS.has(v)
        ) &&
        typeof value.lastDirective === 'string' &&
        isCount(value.turn) &&
        isOptional(value.lastCompaction, isCompactionRecord) &&
        isCount(value.compactions) &&
        isCycle(value.cycle) &&
        isGrowth(value.growth) &&
        Array.isArray(value.cache) &&
        value.cache.every((v) => typeof v === 'number') &&
        isTotals(value.forkUsage) &&
        isTelemetrySessionData(value.telemetry) &&
        typeof value.needsCycleBaseline === 'boolean'
    )
}
