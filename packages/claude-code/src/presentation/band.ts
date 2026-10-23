import {
    formatTokens,
    type ContextPilotController,
} from '@intelligent-compact/core'
import { miniMeter, type Run } from './gauge'
import { line } from './primitives'
import { automationLabel } from './status'
import { automationTone, levelTone } from './theme'
import type { CommonUi, ViewElement } from './ui-port'

/** Columns the host keeps at the band's right edge for its own control. */
const HOST_RESERVE = 6

interface Segment {
    readonly runs: readonly Run[]
    /** Lower stays longer: 0 is never dropped. */
    readonly priority: number
}

function width(runs: readonly Run[]): number {
    return runs.reduce((sum, run) => sum + run.text.length, 0)
}

/** Drops the least important segments until the line fits `columns`. */
export function fitSegments(
    segments: readonly Segment[],
    columns: number
): Run[] {
    let kept = [...segments]
    const total = () => width(kept.flatMap((segment) => segment.runs))
    while (total() > columns - HOST_RESERVE) {
        const worst = Math.max(...kept.map((segment) => segment.priority))
        if (worst === 0) break
        const index = kept.findLastIndex(
            (segment) => segment.priority === worst
        )
        kept = kept.toSpliced(index, 1)
    }
    return kept.flatMap((segment) => segment.runs)
}

export function contextPercent(
    tokens: number | undefined,
    window: number,
    percent: number | undefined
): number | undefined {
    if (percent !== undefined && Number.isFinite(percent)) return percent
    if (tokens !== undefined && window > 0) return (tokens / window) * 100
    return undefined
}

export function percentText(percent: number | undefined): string {
    return percent === undefined ? '—' : `${Math.round(percent)}%`
}

/**
 * One line above the prompt, fitted to its width:
 * `◆ context-pilot balanced ▰▰▰▱▱▱▱▱▱▱ 41% · 412k/1.00M · next 430k · probes 2/5 · ● AUTO`
 */
export function renderBand(
    ui: CommonUi,
    controller: ContextPilotController,
    downstream: ViewElement,
    columns: number
): ViewElement {
    const state = controller.snapshot
    const policy = state.resolvedPolicy
    const { tokens, window } = state.context
    const percent = contextPercent(tokens, window, state.context.percent)
    const fill = levelTone(tokens, policy?.arm, policy?.mandatory)
    const label = automationLabel(controller)
    const dot: Run = { text: ' · ', tone: 'faint' }

    const segments: Segment[] = [
        {
            priority: 0,
            runs: [
                { text: '◆ ', tone: state.lastError ? 'bad' : 'accent' },
                { text: 'context-pilot', tone: 'accent', bold: true },
            ],
        },
        {
            priority: 5,
            runs: [{ text: ` ${policy?.id ?? 'unresolved'}`, tone: 'muted' }],
        },
        {
            priority: 0,
            runs: [
                { text: '  ', tone: 'faint' },
                ...miniMeter(percent, 8, fill),
                { text: ` ${percentText(percent)}`, tone: fill, bold: true },
            ],
        },
        {
            priority: 4,
            runs: [
                dot,
                {
                    text: `${formatTokens(tokens)}/${formatTokens(window)}`,
                    tone: 'muted',
                },
            ],
        },
        {
            priority: 2,
            runs: [
                dot,
                {
                    text: `next ${formatTokens(state.nextProbeAt)}`,
                    tone: 'muted',
                },
            ],
        },
        {
            priority: 3,
            runs: [
                dot,
                {
                    text: `probes ${state.cycle.probes}/${policy?.maxProbesPerCycle ?? '—'}`,
                    tone: 'muted',
                },
            ],
        },
    ]
    if (state.mode !== 'idle') {
        segments.push({
            priority: 1,
            runs: [
                dot,
                {
                    text:
                        state.mode === 'probing' ? '◐ probing' : '◑ compacting',
                    tone: state.mode === 'probing' ? 'warn' : 'accent',
                },
            ],
        })
    }
    segments.push({
        priority: 0,
        runs: [
            dot,
            { text: `● ${label}`, tone: automationTone(label), bold: true },
        ],
    })
    if (state.lastError) {
        segments.push({
            priority: 0,
            runs: [dot, { text: '✖ error', tone: 'bad' }],
        })
    } else if (state.warnings.length > 0) {
        segments.push({
            priority: 0,
            runs: [dot, { text: '⚠ warn', tone: 'warn' }],
        })
    }

    return ui.Box({
        flexDirection: 'column',
        children: [downstream, line(ui, fitSegments(segments, columns))],
    })
}
