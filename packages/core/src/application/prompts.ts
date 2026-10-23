import {
    COMPACT_REASONS,
    WAIT_REASONS,
    type ProbeBounds,
} from '../domain/decision'
import type { ResolvedPolicy } from '../domain/policy'

export interface ProbePromptContext {
    readonly tokens: number
    readonly window: number
    readonly policy: ResolvedPolicy
    readonly meanDelta?: number | undefined
    readonly p90Delta?: number | undefined
    readonly compactions: number
    readonly tokensSinceCompaction?: number | undefined
    readonly probes: number
}

export type DirectiveTrigger = 'mandatory' | 'pre-mandatory' | 'manual'

const ISOLATION =
    'You are an isolated compaction controller for the conversation above. Do not continue the task, do not call tools, and do not explain your reasoning.'

const DIRECTIVE_RULE =
    'Do not write the summary. Write only the preservation directive: the facts generic summarization is most likely to lose and most expensive to reconstruct, most important first, separated by "; ".'

function known(value: number | undefined): string {
    return value === undefined ? 'unknown' : String(value)
}

/**
 * Probe prompts. The fixed instructions come first and the per-call numbers
 * last, so every probe of a session shares the same text up to the state block.
 */
export class SemanticProbePromptFactory {
    decisionPrompt(context: ProbePromptContext, bounds: ProbeBounds): string {
        const { policy } = context
        return [
            ISOLATION,
            'Decide whether the end of the latest assistant turn is a good point for lossy compaction of the conversation.',
            'COMPACT when a semantic seam is here: a task or sub-task is finished, tests just went green, a plan was accepted, or the user switched topics.',
            'WAIT when compaction now would lose live working state: a failing test or open debugging hypothesis, a half-finished multi-file edit, or a question the user has not answered yet.',
            'A mediocre seam with a good preservation directive beats a forced compaction in the middle of a task: prefer COMPACT when fewer than about three turns of headroom remain.',
            'If WAIT, choose the next probe point as an absolute token count inside nextProbeBounds: far when no seam is near, near when one is approaching.',
            `If COMPACT, ${DIRECTIVE_RULE}`,
            `Reason codes: ${COMPACT_REASONS.join(', ')} (COMPACT); ${WAIT_REASONS.join(', ')} (WAIT).`,
            'Reply with exactly one JSON object and nothing else, in one of these forms:',
            '{"a":"W","n":<integer>,"r":"<reason>"}',
            '{"a":"C","i":"<directive>","r":"<reason>"}',
            '',
            'State:',
            `context=${context.tokens}/${context.window} arm=${policy.arm} mandatory=${policy.mandatory} headroom=${policy.mandatory - context.tokens}`,
            `avgTurnGrowth=${known(context.meanDelta)} p90TurnGrowth=${known(context.p90Delta)}`,
            `compactionsThisSession=${context.compactions} tokensSinceLastCompaction=${known(context.tokensSinceCompaction)} probesThisCycle=${context.probes}/${policy.maxProbesPerCycle}`,
            `nextProbeBounds=${bounds.lower}..${bounds.upper}`,
            `directiveMaxChars=${policy.directiveMaxChars}`,
        ].join('\n')
    }

    mandatoryDirectivePrompt(
        context: ProbePromptContext,
        trigger: DirectiveTrigger
    ): string {
        return [
            ISOLATION,
            `Compaction will run now (${trigger}). ${DIRECTIVE_RULE}`,
            'Reply with exactly one JSON object and nothing else:',
            '{"a":"C","i":"<directive>","r":"<reason>"}',
            '',
            'State:',
            `context=${context.tokens}/${context.window} mandatory=${context.policy.mandatory}`,
            `directiveMaxChars=${context.policy.directiveMaxChars}`,
        ].join('\n')
    }
}
