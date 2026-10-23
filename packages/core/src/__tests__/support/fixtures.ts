import { ContextPilotController } from '../../application/controller'
import type {
    CompactResult,
    ForkOutcome,
    RuntimePort,
} from '../../application/ports'
import { SemanticProbePromptFactory } from '../../application/prompts'
import { ProbeDecisionParser, ProbeScheduler } from '../../domain/decision'
import { InstructionComposer } from '../../domain/instructions'
import { PolicyRegistry, type PolicyDefinitionData } from '../../domain/policy'
import {
    ContextPilotState,
    type ContextSnapshot,
    type ForkUsage,
} from '../../domain/state'
import type { TelemetryData } from '../../domain/telemetry'

export const WARM: ForkUsage = {
    input: 100,
    output: 20,
    cacheRead: 9_900,
    cacheWrite: 0,
}
export const COLD: ForkUsage = {
    input: 9_000,
    output: 20,
    cacheRead: 0,
    cacheWrite: 1_000,
}

export interface PolicyOverrides {
    arm?: number
    mandatory?: number
    hostHeadroom?: number
    minGap?: number
    maxGap?: number
    maxProbesPerCycle?: number
    cacheFloor?: number
    minProgress?: number
    directiveMaxChars?: number
    forkOnMandatory?: boolean
    injectNative?: boolean
}

const tokenSpec = (value: number) => ({ unit: 'tokens' as const, value })

/** A token-unit policy: arm 300k, mandatory 500k of a 1M window by default. */
export function policyData(o: PolicyOverrides = {}): PolicyDefinitionData {
    return {
        id: 'test',
        label: 'Test',
        thresholds: {
            arm: tokenSpec(o.arm ?? 300_000),
            mandatory: tokenSpec(o.mandatory ?? 500_000),
            hostHeadroom: tokenSpec(o.hostHeadroom ?? 100_000),
        },
        probe: {
            minGap: tokenSpec(o.minGap ?? 15_000),
            maxGap: tokenSpec(o.maxGap ?? 50_000),
            maxProbesPerCycle: o.maxProbesPerCycle ?? 5,
            cacheFloor: o.cacheFloor ?? 0.7,
        },
        compaction: {
            minProgress: tokenSpec(o.minProgress ?? 150_000),
            directiveMaxChars: o.directiveMaxChars ?? 200,
            forkOnMandatory: o.forkOnMandatory ?? true,
            injectNative: o.injectNative ?? true,
            baseInstructions: 'BASE',
        },
    }
}

export function registryOf(o: PolicyOverrides = {}): PolicyRegistry {
    return new PolicyRegistry({
        schemaVersion: 2,
        activePolicyId: 'test',
        policies: [policyData(o)],
    })
}

export const wait = (n: number, r = 'midphase'): ForkOutcome => ({
    kind: 'answered',
    text: JSON.stringify({ a: 'W', n, r }),
    usage: WARM,
})

export const compact = (i: string, r = 'done'): ForkOutcome => ({
    kind: 'answered',
    text: JSON.stringify({ a: 'C', i, r }),
    usage: WARM,
})

export interface ForkCall {
    readonly prompt: string
    readonly tokens: number | undefined
    readonly kind: 'decision' | 'directive'
}

/**
 * A scriptable runtime. `compact` drops the fill to `after` unless a failure
 * is queued; forks answer from `replies`, then from `defaultReply`.
 */
export class FakeRuntime implements RuntimePort {
    context: ContextSnapshot = { tokens: 0, window: 1_000_000 }
    replies: ForkOutcome[] = []
    defaultReply: (call: ForkCall) => ForkOutcome = () => ({
        kind: 'unavailable',
        reason: 'nothing-to-fork',
    })
    compactFailures: Array<'skip' | 'throw'> = []
    after: number | undefined = 30_000
    readonly forks: ForkCall[] = []
    readonly compactions: Array<{
        instructions: string
        before?: number | undefined
    }> = []
    readonly saved: TelemetryData[] = []
    toasts = 0

    get tokens(): number | undefined {
        return this.context.tokens
    }
    set tokens(value: number | undefined) {
        this.context = { ...this.context, tokens: value }
    }

    async readContext(): Promise<ContextSnapshot> {
        return this.context
    }
    async fork(prompt: string): Promise<ForkOutcome> {
        const call: ForkCall = {
            prompt,
            tokens: this.context.tokens,
            kind: prompt.includes('Compaction will run now')
                ? 'directive'
                : 'decision',
        }
        this.forks.push(call)
        return this.replies.shift() ?? this.defaultReply(call)
    }
    async compact(instructions: string): Promise<CompactResult> {
        const failure = this.compactFailures.shift()
        if (failure === 'throw') throw new Error('host refused')
        if (failure === 'skip') return { skip: 'vetoed' }
        const before = this.context.tokens
        this.compactions.push({ instructions, before })
        this.tokens = this.after
        return { tokensBefore: before, tokensAfter: this.after }
    }
    async sessionId(): Promise<string> {
        return 'session'
    }
    async toast(): Promise<void> {
        this.toasts += 1
    }
    async invalidateUi(): Promise<void> {}
    async saveTelemetry(data: TelemetryData): Promise<void> {
        this.saved.push(data)
    }

    decisionForks(): ForkCall[] {
        return this.forks.filter((call) => call.kind === 'decision')
    }
    directiveForks(): ForkCall[] {
        return this.forks.filter((call) => call.kind === 'directive')
    }
}

export function controllerOf(
    o: PolicyOverrides = {},
    settings = { autoEnabled: true, hostCanCompact: true }
): ContextPilotController {
    return new ContextPilotController(
        registryOf(o),
        new ContextPilotState(),
        {
            parser: new ProbeDecisionParser(),
            scheduler: new ProbeScheduler(),
            prompts: new SemanticProbePromptFactory(),
            composer: new InstructionComposer(),
        },
        settings
    )
}

/** Sets the fill and completes one main turn. */
export async function turn(
    controller: ContextPilotController,
    runtime: FakeRuntime,
    tokens: number | undefined
): Promise<void> {
    runtime.tokens = tokens
    await controller.onMainTurnComplete(runtime)
}
