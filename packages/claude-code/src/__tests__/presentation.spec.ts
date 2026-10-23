import { describe, expect, it } from 'vitest'
import { fitSegments, percentText } from '../presentation/band'
import {
    gaugeBar,
    gaugeLabels,
    merge,
    miniMeter,
    type Run,
} from '../presentation/gauge'
import {
    automationTone,
    color,
    decisionTone,
    levelTone,
} from '../presentation/theme'

const text = (runs: readonly Run[]) => runs.map((run) => run.text).join('')

function segment(label: string, priority: number) {
    return { priority, runs: [{ text: label, tone: 'text' as const }] }
}

describe('gauge', () => {
    const base = {
        width: 20,
        window: 1_000_000,
        arm: 300_000,
        mandatory: 500_000,
    }

    it('fills to the context level and draws the thresholds as ticks', () => {
        const bar = gaugeBar({ ...base, tokens: 400_000 })
        // 400k of 1M is 8 of 20 cells; the arm tick sits at 6, mandatory at 10
        expect(text(bar)).toBe('━━━━━━┃━──┃─────────')
        expect(bar.find((run) => run.text.startsWith('━'))?.tone).toBe('warn')
        expect(
            bar.filter((run) => run.text === '┃').map((run) => run.tone)
        ).toEqual(['text', 'bad'])
    })

    it('tones the fill by zone and leaves an unknown level empty', () => {
        const tone = (tokens: number | undefined) =>
            gaugeBar({ ...base, tokens }).find((run) => run.text.includes('━'))
                ?.tone
        expect(tone(100_000)).toBe('good')
        expect(tone(600_000)).toBe('bad')
        expect(text(gaugeBar({ ...base, tokens: undefined }))).not.toContain(
            '━'
        )
    })

    it('marks the host autocompact point only inside the window', () => {
        expect(text(gaugeBar({ ...base, host: 900_000 }))).toContain('╎')
        expect(text(gaugeBar({ ...base, host: 1_000_000 }))).not.toContain('╎')
    })

    it('places captions at their ticks and drops one that would collide', () => {
        const labels = text(gaugeLabels({ ...base, width: 60 }))
        expect(labels.indexOf('└ arm 300k')).toBe(18)
        expect(labels.indexOf('└ mandatory 500k')).toBe(30)

        const crowded = text(
            gaugeLabels({ ...base, width: 30, mandatory: 350_000 })
        )
        expect(crowded).toContain('arm 300k')
        expect(crowded).not.toContain('mandatory')
    })

    it('right-aligns a caption that would overflow the edge', () => {
        const labels = text(
            gaugeLabels({ width: 30, window: 1_000_000, host: 950_000 })
        )
        expect(labels.trimEnd().endsWith('host 950k ┘')).toBe(true)
        expect(labels).toHaveLength(30)
    })

    it('merges adjacent runs of one style', () => {
        expect(
            merge([
                { text: 'a', tone: 'good' },
                { text: 'b', tone: 'good' },
                { text: '', tone: 'bad' },
                { text: 'c', tone: 'bad' },
            ])
        ).toEqual([
            { text: 'ab', tone: 'good' },
            { text: 'c', tone: 'bad' },
        ])
    })

    it('draws a short meter, empty when the level is unknown', () => {
        expect(text(miniMeter(50, 8, 'good'))).toBe('▰▰▰▰▱▱▱▱')
        expect(text(miniMeter(undefined, 4, 'good'))).toBe('▱▱▱▱')
    })
})

describe('band fitting', () => {
    const segments = [
        segment('core ', 0),
        segment('policy ', 5),
        segment('next ', 2),
        segment('probes ', 3),
        segment('AUTO', 0),
    ]

    it('keeps everything when it fits', () => {
        expect(text(fitSegments(segments, 80))).toBe(
            'core policy next probes AUTO'
        )
    })

    it('drops the least important segments first and never priority 0', () => {
        expect(text(fitSegments(segments, 26))).toBe('core next AUTO')
        expect(text(fitSegments(segments, 5))).toBe('core AUTO')
    })

    it('rounds the percentage', () => {
        expect(percentText(41.6)).toBe('42%')
        expect(percentText(undefined)).toBe('—')
    })
})

describe('theme', () => {
    it('maps tones to theme keys', () => {
        expect(color('accent')).toBe('claude')
        expect(color('good')).toBe('success')
        expect(color('faint')).toBe('subtle')
    })

    it('tones levels, modes and decisions', () => {
        expect(levelTone(undefined, 1, 2)).toBe('muted')
        expect(levelTone(1, undefined, undefined)).toBe('good')
        expect(automationTone('AUTO')).toBe('good')
        expect(automationTone('MANUAL')).toBe('warn')
        expect(automationTone('OBSERVE')).toBe('muted')
        expect(
            decisionTone('Compaction failed (semantic); retry at turn 3')
        ).toBe('bad')
        expect(decisionTone('Compacted (semantic)')).toBe('accent')
        expect(decisionTone('WAIT (edit); next probe at 400k')).toBe('warn')
        expect(decisionTone('Probe budget spent; holding to mandatory')).toBe(
            'warn'
        )
        expect(decisionTone('Not evaluated')).toBe('muted')
        expect(decisionTone('Below policy arm point')).toBe('text')
    })
})
