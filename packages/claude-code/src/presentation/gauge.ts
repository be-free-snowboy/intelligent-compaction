import { formatTokens } from '@intelligent-compact/core'
import { levelTone, type Tone } from './theme'

/** A styled run of characters; adjacent runs of one style are merged. */
export interface Run {
    readonly text: string
    readonly tone: Tone
    readonly bold?: boolean | undefined
}

export interface GaugeInput {
    readonly width: number
    readonly tokens?: number | undefined
    readonly window: number
    readonly arm?: number | undefined
    readonly mandatory?: number | undefined
    readonly host?: number | undefined
}

interface Marker {
    readonly at: number
    readonly glyph: string
    /** The tick's own tone: it must stand out from any fill it crosses. */
    readonly glyphTone: Tone
    readonly tone: Tone
    readonly label: string
}

const FILLED = '━'
const EMPTY = '─'

export function merge(runs: readonly Run[]): Run[] {
    const merged: Run[] = []
    for (const run of runs) {
        const last = merged.at(-1)
        if (last && last.tone === run.tone && last.bold === run.bold) {
            merged[merged.length - 1] = { ...last, text: last.text + run.text }
        } else if (run.text.length > 0) {
            merged.push(run)
        }
    }
    return merged
}

function column(value: number, window: number, width: number): number {
    return Math.min(
        width - 1,
        Math.max(0, Math.floor((value / window) * width))
    )
}

function markers(input: GaugeInput): Marker[] {
    const { width, window } = input
    if (window <= 0) return []
    const list: Marker[] = []
    if (input.arm !== undefined)
        list.push({
            at: column(input.arm, window, width),
            glyph: '┃',
            glyphTone: 'text',
            tone: 'warn',
            label: `arm ${formatTokens(input.arm)}`,
        })
    if (input.mandatory !== undefined)
        list.push({
            at: column(input.mandatory, window, width),
            glyph: '┃',
            glyphTone: 'bad',
            tone: 'bad',
            label: `mandatory ${formatTokens(input.mandatory)}`,
        })
    if (input.host !== undefined && input.host < window)
        list.push({
            at: column(input.host, window, width),
            glyph: '╎',
            glyphTone: 'muted',
            tone: 'muted',
            label: `host ${formatTokens(input.host)}`,
        })
    return list
}

/** The context bar: fill toned by zone, thresholds drawn as ticks. */
export function gaugeBar(input: GaugeInput): Run[] {
    const { width, window, tokens } = input
    const filled =
        tokens === undefined || window <= 0
            ? 0
            : Math.min(width, Math.round((tokens / window) * width))
    const fill = levelTone(tokens, input.arm, input.mandatory)
    const ticks = new Map(markers(input).map((m) => [m.at, m]))
    const runs: Run[] = []
    for (let i = 0; i < width; i += 1) {
        const tick = ticks.get(i)
        if (tick) runs.push({ text: tick.glyph, tone: tick.glyphTone })
        else if (i < filled) runs.push({ text: FILLED, tone: fill })
        else runs.push({ text: EMPTY, tone: 'faint' })
    }
    return merge(runs)
}

/**
 * Threshold captions under the bar: each starts at its tick (`└ arm 325k`),
 * or ends there when it would overflow (`mandatory 500k ┘`). A caption that
 * would overlap one already placed is left out.
 */
export function gaugeLabels(input: GaugeInput): Run[] {
    const cells: (Run | undefined)[] = Array.from({ length: input.width })
    const taken: boolean[] = Array.from({ length: input.width }, () => false)
    for (const marker of markers(input)) {
        const right = `└ ${marker.label}`
        const left = `${marker.label} ┘`
        let start = marker.at
        let text = right
        if (start + text.length > input.width) {
            text = left
            start = marker.at - text.length + 1
        }
        if (start < 0) continue
        const end = start + text.length
        const free = taken
            .slice(Math.max(0, start - 1), Math.min(input.width, end + 1))
            .every((cell) => !cell)
        if (!free) continue
        for (let i = start; i < end; i += 1) {
            taken[i] = true
            cells[i] = { text: text.charAt(i - start), tone: marker.tone }
        }
    }
    return merge(cells.map((cell) => cell ?? { text: ' ', tone: 'faint' }))
}

/** A short block meter for one-line places such as the status band. */
export function miniMeter(
    percent: number | undefined,
    width: number,
    tone: Tone
): Run[] {
    const value = Math.max(0, Math.min(100, percent ?? 0))
    const filled = percent === undefined ? 0 : Math.round((value / 100) * width)
    return merge([
        { text: '▰'.repeat(filled), tone },
        { text: '▱'.repeat(width - filled), tone: 'faint' },
    ])
}
