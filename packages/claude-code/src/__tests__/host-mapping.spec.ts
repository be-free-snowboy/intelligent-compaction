import { describe, expect, it } from 'vitest'
import { toForkOutcome } from '../host-mapping'

const usage = {
    input_tokens: 10,
    output_tokens: 20,
    cache_read_input_tokens: 300,
    cache_creation_input_tokens: 4,
}
const mapped = { input: 10, output: 20, cacheRead: 300, cacheWrite: 4 }

describe('toForkOutcome', () => {
    it('maps an answered fork with its usage', () => {
        expect(toForkOutcome({ isAnswered: true, text: '{}', usage })).toEqual({
            kind: 'answered',
            text: '{}',
            usage: mapped,
        })
    })

    it('maps nothing-to-fork without usage', () => {
        expect(
            toForkOutcome({ isAnswered: false, reason: 'nothing-to-fork' })
        ).toEqual({ kind: 'unavailable', reason: 'nothing-to-fork' })
    })

    it.each(['empty-reply', 'aborted'] as const)(
        'keeps the usage of a %s fork',
        (reason) => {
            expect(toForkOutcome({ isAnswered: false, reason, usage })).toEqual(
                { kind: 'unavailable', reason, usage: mapped }
            )
        }
    )

    it('keeps the usage of an api-error fork', () => {
        expect(
            toForkOutcome({
                isAnswered: false,
                reason: 'api-error',
                status: 529,
                error: 'overloaded',
                usage,
            })
        ).toEqual({ kind: 'unavailable', reason: 'api-error', usage: mapped })
    })
})
