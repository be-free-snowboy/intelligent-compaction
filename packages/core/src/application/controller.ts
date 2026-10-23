import type { ProbeBounds } from '../domain/decision'
import { ProbeDecisionParser, ProbeScheduler } from '../domain/decision'
import type { InstructionComposer } from '../domain/instructions'
import type { PolicyRegistry, ResolvedPolicy } from '../domain/policy'
import type {
    CompactionSource,
    ContextPilotState,
    CycleState,
    ForkUsageTotals,
    SessionCarry,
} from '../domain/state'
import { formatTokens } from '../shared/format'
import type { ForkOutcome, RuntimePort } from './ports'
import type {
    DirectiveTrigger,
    ProbePromptContext,
    SemanticProbePromptFactory,
} from './prompts'

export interface ControllerSettings {
    readonly autoEnabled: boolean
    /** False where the host cannot run plugin compaction (headless sessions). */
    readonly hostCanCompact: boolean
}

export interface ControllerDependencies {
    readonly parser: ProbeDecisionParser
    readonly scheduler: ProbeScheduler
    readonly prompts: SemanticProbePromptFactory
    readonly composer: InstructionComposer
}

/** A fill reading without the host's autocompact details. */
export interface LiveContext {
    readonly tokens?: number | undefined
    readonly window: number
    readonly percent?: number | undefined
}

/** Longest wait, in main turns, before a failed compaction is retried. */
export const MAX_RETRY_DELAY_TURNS = 8

/**
 * The V1 control loop (docs/ARCHITECTURE.md §4). Every automatic action runs
 * after a completed main-thread turn; manual commands share the same
 * serialized queue.
 */
export class ContextPilotController {
    private readonly registry: PolicyRegistry
    private readonly state: ContextPilotState
    private readonly deps: ControllerDependencies
    private settings: ControllerSettings
    private operation: Promise<void> | undefined
    /** Set when a compaction left no known fill; the next turn end supplies it. */
    private needsCycleBaseline = false

    constructor(
        registry: PolicyRegistry,
        state: ContextPilotState,
        deps: ControllerDependencies,
        settings: ControllerSettings
    ) {
        this.registry = registry
        this.state = state
        this.deps = deps
        this.settings = settings
    }

    get policyRegistry(): PolicyRegistry {
        return this.registry
    }
    get snapshot(): ContextPilotState {
        return this.state
    }
    get autoEnabled(): boolean {
        return this.settings.autoEnabled
    }
    get hostCanCompact(): boolean {
        return this.settings.hostCanCompact
    }

    setAutoEnabled(enabled: boolean): void {
        this.settings = { ...this.settings, autoEnabled: enabled }
    }

    setHostCanCompact(value: boolean): void {
        this.settings = { ...this.settings, hostCanCompact: value }
    }

    /**
     * Starts the session, or takes up `carry` when it is this session's (a
     * reload of the plugin); true when it did.
     */
    async initialize(runtime: RuntimePort, carry?: unknown): Promise<boolean> {
        const sessionId = await runtime.sessionId()
        const resumed = this.state.restore(carry, sessionId)
        if (resumed) {
            this.needsCycleBaseline = (carry as SessionCarry).needsCycleBaseline
        } else {
            this.resetSession(sessionId)
        }
        await this.refresh(runtime)
        return resumed
    }

    /** The session's state as JSON for `initialize` after a reload. */
    carry(): SessionCarry | undefined {
        return this.state.toCarry(this.needsCycleBaseline)
    }

    /**
     * Takes a fill the host pushed (between the reads `refresh` makes); true
     * when what the views show changed.
     */
    observeContext(reading: LiveContext): boolean {
        const current = this.state.context
        if (
            current.tokens === reading.tokens &&
            current.window === reading.window &&
            current.percent === reading.percent &&
            this.state.resolvedPolicy !== undefined
        ) {
            return false
        }
        this.state.context = { ...current, ...reading }
        try {
            this.state.resolvedPolicy = this.registry
                .active()
                .resolve(reading.window)
        } catch (error) {
            this.state.lastError = errorText(error)
        }
        return true
    }

    /** Clears every session-local value; settings and lifetime telemetry stay. */
    resetSession(sessionId?: string | undefined): void {
        this.state.reset(sessionId)
        this.needsCycleBaseline = false
    }

    /** Reads the host context; true when a fresh reading was obtained. */
    async refresh(runtime: RuntimePort): Promise<boolean> {
        try {
            const context = await runtime.readContext()
            this.state.context = context
            const policy = this.registry.active().resolve(context.window)
            this.state.resolvedPolicy = policy
            this.state.warnings = this.warnings(policy)
            if (
                context.tokens !== undefined &&
                this.state.nextProbeAt === undefined
            ) {
                this.state.nextProbeAt = policy.arm
            }
            this.state.lastError = undefined
            return true
        } catch (error) {
            this.state.resolvedPolicy = undefined
            this.state.lastError = errorText(error)
            return false
        } finally {
            await runtime.invalidateUi()
        }
    }

    async onMainTurnComplete(runtime: RuntimePort): Promise<void> {
        await this.serialize(async () => {
            this.state.turn += 1
            const fresh = await this.refresh(runtime)
            this.observeTurnEnd(fresh)
            await this.evaluateAutomatic(runtime)
        })
    }

    /** Dry run: one decision fork, reported, never executed (invariant 6). */
    async evaluateNow(runtime: RuntimePort): Promise<void> {
        await this.serialize(async () => {
            const scheduled = this.state.nextProbeAt
            await this.refresh(runtime)
            this.state.nextProbeAt = scheduled
            const tokens = this.state.context.tokens
            const policy = this.state.resolvedPolicy
            if (tokens === undefined || !policy) {
                this.state.lastDecision = 'EVALUATE: context fill unknown'
                return
            }
            const bounds = this.bounds(tokens, policy)
            const outcome = await this.fork(
                runtime,
                this.deps.prompts.decisionPrompt(
                    this.promptContext(tokens, policy),
                    bounds
                )
            )
            if (outcome.kind === 'unavailable') {
                this.state.lastDecision = `EVALUATE: fork unavailable (${outcome.reason})`
                return
            }
            try {
                const decision = this.deps.parser.parse(
                    outcome.text,
                    policy.directiveMaxChars
                )
                this.state.lastReason = decision.reason
                this.state.telemetry.logDecision({
                    turn: this.state.turn,
                    tokens,
                    action: 'evaluate',
                    reason: decision.reason,
                    usage: outcome.usage,
                })
                if (decision.action === 'wait') {
                    this.state.lastDecision = `EVALUATE: WAIT (${decision.reason}); would probe at ${formatTokens(this.deps.scheduler.clamp(decision.requestedNextProbeAt, bounds))}`
                    this.state.lastDirective = ''
                } else {
                    this.state.lastDecision = `EVALUATE: COMPACT recommended (${decision.reason}); nothing executed`
                    this.state.lastDirective = decision.directive
                }
            } catch (error) {
                this.state.telemetry.count('parseFailures')
                this.state.lastError = `Unparseable probe reply: ${errorText(error)}`
                this.state.lastDecision = 'EVALUATE: unparseable reply'
            }
        })
    }

    /** Compacts now in any mode, with one directive fork when the policy asks. */
    async compactNow(runtime: RuntimePort): Promise<void> {
        await this.serialize(async () => {
            await this.refresh(runtime)
            const policy = this.state.resolvedPolicy
            if (!policy) {
                this.state.lastDecision =
                    'Compaction refused: policy unresolved'
                return
            }
            if (!this.settings.hostCanCompact) {
                this.state.lastDecision =
                    'Compaction unavailable: this session cannot run plugin compaction; use /compact'
                return
            }
            const directive = policy.forkOnMandatory
                ? await this.directiveFork(runtime, policy, 'manual')
                : ''
            await this.execute(runtime, policy, directive, 'manual')
        })
    }

    /**
     * Instructions for a host-initiated compaction (`auto`, `manual`,
     * `precompute`), or undefined when the policy does not inject.
     */
    nativeInstructions(user?: string | undefined): string | undefined {
        const compaction = this.registry.active().compaction
        if (!compaction.injectNative) return undefined
        this.state.telemetry.count('injections')
        return this.deps.composer.compose({
            user,
            base: compaction.baseInstructions,
            directive: this.state.cycle.pending?.directive,
        })
    }

    /** A host compaction of the main thread stood: open a new cycle. */
    noteExternalCompaction(
        source: string,
        before?: number | undefined,
        after?: number | undefined
    ): void {
        const recordedBefore = before ?? this.state.context.tokens ?? 0
        this.recordCompaction(
            source,
            recordedBefore,
            after,
            this.state.cycle.pending?.directive ?? ''
        )
        // The host counts its result over the transcript only; the live fill
        // is unknown until the next response is measured.
        this.state.context = { ...this.state.context, tokens: undefined }
        this.state.lastDecision = `Observed ${source} compaction`
        this.state.lastDirective = ''
    }

    private observeTurnEnd(fresh: boolean): void {
        const tokens = fresh ? this.state.context.tokens : undefined
        if (tokens === undefined) {
            // A missing reading breaks the chain: no delta spans it.
            this.state.growth.rebase(undefined)
            return
        }
        const delta = this.state.growth.observe(tokens)
        if (delta !== undefined) this.state.telemetry.observeGrowth(delta)
        if (this.needsCycleBaseline) {
            this.state.cycle.startTokens = tokens
            this.needsCycleBaseline = false
        }
    }

    private async evaluateAutomatic(runtime: RuntimePort): Promise<void> {
        const tokens = this.state.context.tokens
        const policy = this.state.resolvedPolicy
        const cycle = this.state.cycle
        if (tokens === undefined) {
            this.state.lastDecision = 'Context fill unknown'
            return
        }
        if (!policy) return
        if (!this.settings.autoEnabled) {
            this.state.lastDecision = 'MANUAL: automatic control off'
            return
        }
        if (!this.settings.hostCanCompact) {
            this.state.lastDecision =
                'OBSERVE: this session cannot run plugin compaction'
            return
        }
        if (
            cycle.startTokens !== undefined &&
            tokens - cycle.startTokens < policy.minProgress
        ) {
            this.state.lastDecision = `Below progress guard (${formatTokens(tokens - cycle.startTokens)} of ${formatTokens(policy.minProgress)} since compaction)`
            return
        }
        if (cycle.pending) {
            if (
                cycle.retryAtTurn !== undefined &&
                this.state.turn < cycle.retryAtTurn
            ) {
                this.state.lastDecision = `Compaction retry deferred to turn ${cycle.retryAtTurn}`
                return
            }
            await this.execute(
                runtime,
                policy,
                cycle.pending.directive,
                cycle.pending.source
            )
            return
        }

        const p90 = this.state.growth.p90()
        if (tokens >= policy.mandatory) {
            await this.pressure(runtime, policy, 'mandatory')
            return
        }
        if (p90 !== undefined && tokens + p90 >= policy.mandatory) {
            await this.pressure(runtime, policy, 'pre-mandatory')
            return
        }
        if (tokens < policy.arm) {
            this.state.nextProbeAt = policy.arm
            this.state.lastDecision = 'Below policy arm point'
            return
        }
        if (cycle.suspended) {
            this.state.lastDecision = suspensionText(cycle.suspended)
            return
        }
        if (cycle.probes >= policy.maxProbesPerCycle) {
            cycle.suspended = 'budget'
            this.state.telemetry.count('budgetExhausted')
            this.state.lastDecision = suspensionText('budget')
            return
        }
        if (
            this.state.nextProbeAt !== undefined &&
            tokens < this.state.nextProbeAt
        )
            return

        await this.probe(runtime, tokens, policy)
    }

    private async probe(
        runtime: RuntimePort,
        tokens: number,
        policy: ResolvedPolicy
    ): Promise<void> {
        const cycle = this.state.cycle
        const telemetry = this.state.telemetry
        const bounds = this.bounds(tokens, policy)
        const outcome = await this.fork(
            runtime,
            this.deps.prompts.decisionPrompt(
                this.promptContext(tokens, policy),
                bounds
            ),
            cycle
        )
        if (this.discardIfStale(cycle)) return

        if (outcome.kind === 'unavailable') {
            if (outcome.reason !== 'nothing-to-fork') {
                cycle.probes += 1
                telemetry.count('probes')
            }
            telemetry.count('forkUnavailable')
            telemetry.logDecision({
                turn: this.state.turn,
                tokens,
                action: 'unavailable',
                usage: outcome.usage,
            })
            this.state.nextProbeAt = bounds.upper
            this.state.lastDecision = `Fork unavailable (${outcome.reason}); next probe at ${formatTokens(bounds.upper)}`
            return
        }

        cycle.probes += 1
        telemetry.count('probes')
        const cacheRatio = this.state.cache.record(outcome.usage)
        if (this.state.cache.isTripped(policy.cacheFloor)) {
            cycle.suspended = 'cache'
            telemetry.count('cacheTrips')
        }

        let decision
        try {
            decision = this.deps.parser.parse(
                outcome.text,
                policy.directiveMaxChars
            )
        } catch (error) {
            telemetry.count('parseFailures')
            telemetry.logDecision({
                turn: this.state.turn,
                tokens,
                action: 'unparseable',
                cacheRatio,
                usage: outcome.usage,
            })
            this.state.nextProbeAt = bounds.upper
            this.state.lastError = `Unparseable probe reply: ${errorText(error)}`
            this.state.lastDecision = `Unparseable probe reply; next probe at ${formatTokens(bounds.upper)}`
            return
        }

        this.state.lastReason = decision.reason
        telemetry.reason(decision.reason)
        telemetry.logDecision({
            turn: this.state.turn,
            tokens,
            action: decision.action,
            reason: decision.reason,
            cacheRatio,
            usage: outcome.usage,
        })
        if (decision.action === 'wait') {
            telemetry.count('waits')
            const next = this.deps.scheduler.clamp(
                decision.requestedNextProbeAt,
                bounds
            )
            this.state.nextProbeAt = next
            this.state.lastDecision = `WAIT (${decision.reason}); next probe at ${formatTokens(next)}`
            this.state.lastDirective = ''
            return
        }

        telemetry.count('compactDecisions')
        this.state.lastDecision = `COMPACT (${decision.reason}) at a semantic seam`
        this.state.lastDirective = decision.directive
        await this.execute(runtime, policy, decision.directive, 'semantic')
    }

    private async pressure(
        runtime: RuntimePort,
        policy: ResolvedPolicy,
        trigger: 'mandatory' | 'pre-mandatory'
    ): Promise<void> {
        const cycle = this.state.cycle
        const directive = policy.forkOnMandatory
            ? await this.directiveFork(runtime, policy, trigger)
            : ''
        if (this.discardIfStale(cycle)) return
        await this.execute(runtime, policy, directive, trigger)
    }

    /** One preservation-directive fork; any failure yields an empty directive. */
    private async directiveFork(
        runtime: RuntimePort,
        policy: ResolvedPolicy,
        trigger: DirectiveTrigger
    ): Promise<string> {
        const tokens = this.state.context.tokens ?? 0
        const outcome = await this.fork(
            runtime,
            this.deps.prompts.mandatoryDirectivePrompt(
                this.promptContext(tokens, policy),
                trigger
            )
        )
        this.state.telemetry.logDecision({
            turn: this.state.turn,
            tokens,
            action: 'directive',
            usage: outcome.usage,
        })
        if (outcome.kind === 'unavailable') {
            this.state.telemetry.count('forkUnavailable')
            return ''
        }
        try {
            const decision = this.deps.parser.parse(
                outcome.text,
                policy.directiveMaxChars
            )
            return decision.action === 'compact' ? decision.directive : ''
        } catch (error) {
            this.state.telemetry.count('parseFailures')
            this.state.lastError = `Unparseable directive reply: ${errorText(error)}`
            return ''
        }
    }

    private async execute(
        runtime: RuntimePort,
        policy: ResolvedPolicy,
        directive: string,
        source: CompactionSource
    ): Promise<void> {
        const cycle = this.state.cycle
        this.state.mode = 'compacting'
        try {
            await runtime.invalidateUi()
            // Last await before the host call: automatic authority is checked here.
            if (source !== 'manual' && this.discardIfStale(cycle)) return
            const before = this.state.context.tokens ?? 0
            const instructions = this.deps.composer.compose({
                base: policy.baseInstructions,
                directive,
            })
            let result
            try {
                result = await runtime.compact(instructions)
            } catch (error) {
                this.fail(errorText(error), directive, source)
                return
            }
            if (result.skip !== undefined) {
                this.fail(
                    `Compaction skipped: ${result.skip}`,
                    directive,
                    source
                )
                return
            }
            this.recordCompaction(
                source,
                result.tokensBefore ?? before,
                result.tokensAfter,
                directive
            )
            this.state.lastDecision = `Compacted (${source})`
            this.state.lastDirective = directive
            // The compaction stands: a failure from here on is reported, never retried.
            try {
                await runtime.toast(
                    `Context Pilot compacted at ${formatTokens(before)}${result.tokensAfter !== undefined ? ` → ${formatTokens(result.tokensAfter)}` : ''} (${source})`
                )
                await runtime.saveTelemetry(this.state.telemetry.toData())
            } catch (error) {
                this.state.lastError = `After compaction: ${errorText(error)}`
                return
            }
            await this.refresh(runtime)
        } finally {
            this.state.mode = 'idle'
            await runtime.invalidateUi()
        }
    }

    private fail(
        message: string,
        directive: string,
        source: CompactionSource
    ): void {
        this.state.lastError = message
        if (source === 'manual') {
            this.state.lastDecision = 'Manual compaction failed'
            return
        }
        const cycle = this.state.cycle
        cycle.failures += 1
        cycle.pending = { source, directive }
        cycle.retryAtTurn =
            this.state.turn +
            Math.min(2 ** (cycle.failures - 1), MAX_RETRY_DELAY_TURNS)
        this.state.telemetry.count('backoffs')
        this.state.lastDecision = `Compaction failed (${source}); retry at turn ${cycle.retryAtTurn}`
    }

    private recordCompaction(
        source: string,
        before: number,
        after: number | undefined,
        directive: string
    ): void {
        const cycle = this.state.cycle
        this.state.telemetry.recordCompaction({
            source,
            before,
            after,
            probes: cycle.probes,
            forkUsage: usageOf(cycle.forkUsage),
            directiveChars: directive.length,
        })
        this.state.lastCompaction = { before, after, source }
        this.state.compactions += 1
        // The host's `after` counts the transcript only (no system prompt or
        // tools), so the cycle baseline is the next measured turn-end fill.
        this.state.startCycle(undefined)
        this.needsCycleBaseline = true
    }

    private async fork(
        runtime: RuntimePort,
        prompt: string,
        cycle = this.state.cycle
    ): Promise<ForkOutcome> {
        this.state.mode = 'probing'
        await runtime.invalidateUi()
        try {
            const outcome = await runtime.fork(prompt)
            if (outcome.usage) this.state.recordForkUsage(outcome.usage, cycle)
            return outcome
        } finally {
            this.state.mode = 'idle'
            await runtime.invalidateUi()
        }
    }

    /**
     * Automatic work applies only in the mode and cycle it was started in:
     * AUTO switched off, or a compaction landed, while it was awaited.
     */
    private discardIfStale(cycle: CycleState): boolean {
        if (
            this.settings.autoEnabled &&
            this.settings.hostCanCompact &&
            this.state.cycle === cycle
        )
            return false
        this.state.lastDecision =
            'Discarded automatic work: the mode or cycle changed while it ran'
        return true
    }

    private bounds(tokens: number, policy: ResolvedPolicy): ProbeBounds {
        return this.deps.scheduler.bounds({
            tokens,
            mandatory: policy.mandatory,
            minGap: policy.minGap,
            maxGap: policy.maxGap,
            meanDelta: this.state.growth.mean(),
            p90Delta: this.state.growth.p90(),
        })
    }

    private promptContext(
        tokens: number,
        policy: ResolvedPolicy
    ): ProbePromptContext {
        const start = this.state.cycle.startTokens
        return {
            tokens,
            window: this.state.context.window,
            policy,
            meanDelta: this.state.growth.mean(),
            p90Delta: this.state.growth.p90(),
            compactions: this.state.compactions,
            tokensSinceCompaction:
                start === undefined ? undefined : tokens - start,
            probes: this.state.cycle.probes,
        }
    }

    private warnings(policy: ResolvedPolicy): string[] {
        const context = this.state.context
        const threshold = context.hostAutoCompactThreshold
        if (
            context.hostAutoCompactEnabled === true &&
            threshold !== undefined &&
            policy.mandatory + policy.hostHeadroom > threshold
        ) {
            return [
                `Host autocompact at ${formatTokens(threshold)} can pre-empt mandatory ${formatTokens(policy.mandatory)} (needs ${formatTokens(policy.hostHeadroom)} headroom)`,
            ]
        }
        return []
    }

    private async serialize(operation: () => Promise<void>): Promise<void> {
        const predecessor = this.operation ?? Promise.resolve()
        const running = predecessor
            .catch(() => undefined)
            .then(operation)
            .finally(() => {
                if (this.operation === running) this.operation = undefined
            })
        this.operation = running
        await running
    }
}

function suspensionText(reason: 'budget' | 'cache'): string {
    return reason === 'budget'
        ? 'Probe budget spent; holding to mandatory'
        : 'Probing suspended: forks miss the prompt cache; holding to mandatory'
}

function usageOf(totals: ForkUsageTotals) {
    return {
        input: totals.input,
        output: totals.output,
        cacheRead: totals.cacheRead,
        cacheWrite: totals.cacheWrite,
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
