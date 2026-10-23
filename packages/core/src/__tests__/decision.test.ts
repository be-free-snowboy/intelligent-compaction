import { describe, expect, it } from 'vitest'
import {
    ProbeDecisionParser,
    ProbeScheduler,
    truncateDirective,
} from '../domain/decision'

const parser = new ProbeDecisionParser()
const scheduler = new ProbeScheduler()

describe('ProbeDecisionParser', () => {
    it('parses WAIT with a known reason', () => {
        expect(parser.parse('{"a":"W","n":412000.4,"r":"debug"}', 100)).toEqual(
            { action: 'wait', requestedNextProbeAt: 412000, reason: 'debug' }
        )
    })

    it('accepts a numeric string for n', () => {
        expect(parser.parse('{"a":"W","n":"5000"}', 100)).toMatchObject({
            requestedNextProbeAt: 5000,
            reason: 'other',
        })
    })

    it('parses COMPACT inside surrounding prose and fences', () => {
        const text = 'Sure.\n```json\n{"a":"C","i":" keep x ","r":"done"}\n```'
        expect(parser.parse(text, 100)).toEqual({
            action: 'compact',
            directive: 'keep x',
            reason: 'done',
        })
    })

    it('maps unknown reasons to other and missing directives to empty', () => {
        expect(parser.parse('{"a":"C","r":"vibes"}', 100)).toEqual({
            action: 'compact',
            directive: '',
            reason: 'other',
        })
    })

    it('truncates long directives on an item boundary', () => {
        const decision = parser.parse(
            JSON.stringify({
                a: 'C',
                i: 'first item; second item; third item',
            }),
            30
        )
        expect(decision).toMatchObject({ directive: 'first item; second item' })
    })

    it.each([
        ['no object', 'nothing here', 'did not contain a JSON object'],
        ['invalid JSON', '{"a":', 'did not contain a JSON object'],
        ['unknown action', '{"a":"X"}', 'must use a=W or a=C'],
        ['non-numeric n', '{"a":"W","n":"soon"}', 'requires numeric n'],
    ])('rejects %s', (_name, text, message) => {
        expect(() => parser.parse(text, 100)).toThrow(message)
    })
})

describe('truncateDirective', () => {
    it('keeps short text whole', () => {
        expect(truncateDirective(' a; b ', 10)).toBe('a; b')
    })

    it('hard-cuts when no boundary lies inside the budget', () => {
        expect(truncateDirective('abcdefghij; k', 8)).toBe('abcdefgh')
    })

    it('J-005: falls back to an early boundary too', () => {
        expect(truncateDirective(`a; ${'b'.repeat(30)}`, 20)).toBe('a')
    })
})

describe('ProbeScheduler', () => {
    const base = { tokens: 400, mandatory: 500, minGap: 10, maxGap: 50 }

    it('uses minGap and maxGap without growth data', () => {
        expect(scheduler.bounds(base)).toEqual({ lower: 410, upper: 450 })
    })

    it('widens the floor to three mean turns, capped at maxGap', () => {
        expect(scheduler.bounds({ ...base, meanDelta: 5 })).toMatchObject({
            lower: 415,
        })
        expect(scheduler.bounds({ ...base, meanDelta: 40 })).toMatchObject({
            lower: 450,
        })
    })

    it('keeps two p90 turns of headroom before mandatory', () => {
        expect(scheduler.bounds({ ...base, p90Delta: 40 })).toEqual({
            lower: 410,
            upper: 420,
        })
        expect(
            scheduler.bounds({ ...base, tokens: 490, p90Delta: 40 })
        ).toEqual({ lower: 490, upper: 490 })
    })

    it('never caps below the fill: the next turn probes inside the guard zone', () => {
        expect(
            scheduler.bounds({
                tokens: 400_000,
                mandatory: 500_000,
                minGap: 15_000,
                maxGap: 50_000,
                meanDelta: 60_000,
                p90Delta: 60_000,
            })
        ).toEqual({ lower: 400_000, upper: 400_000 })
    })

    it('clamps and rounds requested probes into the bounds', () => {
        const bounds = { lower: 410, upper: 450 }
        expect(scheduler.clamp(1, bounds)).toBe(410)
        expect(scheduler.clamp(999, bounds)).toBe(450)
        expect(scheduler.clamp(420.6, bounds)).toBe(421)
    })
})
