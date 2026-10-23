import type { ModelForkResult, ModelUsage } from 'claude-code'
import type { ForkOutcome, ForkUsage } from '@intelligent-compact/core'

/** Maps the engine's provider-shaped token counts into the core's host-neutral shape. */
export function toForkUsage(usage: ModelUsage): ForkUsage {
    return {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens,
        cacheWrite: usage.cache_creation_input_tokens,
    }
}

/**
 * Maps every arm of the engine's fork result. Failure arms keep their usage because a
 * failed fork can still have paid for the transcript prefix.
 */
export function toForkOutcome(result: ModelForkResult): ForkOutcome {
    if (result.isAnswered) {
        return {
            kind: 'answered',
            text: result.text,
            usage: toForkUsage(result.usage),
        }
    }
    if (result.reason === 'nothing-to-fork') {
        return { kind: 'unavailable', reason: result.reason }
    }
    return {
        kind: 'unavailable',
        reason: result.reason,
        usage: toForkUsage(result.usage),
    }
}
