import type { Run } from './gauge'
import { color, type Tone } from './theme'
import type { CommonUi, PaneLayout, ViewElement } from './ui-port'

/** Usable columns inside a pane: its width less one cell of padding a side. */
export function contentWidth(layout: PaneLayout): number {
    return Math.max(40, Math.min(100, layout.columns - 2))
}

export function runs(ui: CommonUi, list: readonly Run[]): ViewElement[] {
    return list.map((run) =>
        ui.Text({
            color: color(run.tone),
            ...(run.bold ? { weight: 'bold' as const } : {}),
            children: [run.text],
        })
    )
}

export function line(
    ui: CommonUi,
    list: readonly Run[],
    wrap: 'truncate' | 'wrap' = 'truncate'
): ViewElement {
    return ui.Text({ wrap, children: runs(ui, list) })
}

/** `Title ───────`: a heading that carries its own rule to the edge. */
export function section(
    ui: CommonUi,
    title: string,
    width: number,
    note?: string
): ViewElement {
    const label = note ? `${title}  ${note}` : title
    const tail = Math.max(2, width - label.length - 1)
    return ui.Text({
        wrap: 'truncate',
        children: [
            ui.Text({
                weight: 'bold',
                color: color('text'),
                children: [title],
            }),
            ...(note
                ? [ui.Text({ color: color('muted'), children: [`  ${note}`] })]
                : []),
            ui.Text({
                color: color('faint'),
                children: [` ${'─'.repeat(tail)}`],
            }),
        ],
    })
}

export function rule(ui: CommonUi, width: number): ViewElement {
    return ui.Text({ color: color('faint'), children: ['─'.repeat(width)] })
}

export function blank(ui: CommonUi): ViewElement {
    return ui.Text({ children: [' '] })
}

/** A label/value pair with the label in a fixed, quiet column. */
export function field(
    ui: CommonUi,
    label: string,
    value: readonly Run[],
    labelWidth: number
): ViewElement {
    return ui.Text({
        wrap: 'truncate',
        children: [
            ui.Text({
                color: color('muted'),
                children: [label.padEnd(labelWidth)],
            }),
            ...runs(ui, value),
        ],
    })
}

/** Two fields side by side, or stacked when the pane is narrow. */
export function fieldPair(
    ui: CommonUi,
    width: number,
    left: ViewElement,
    right: ViewElement | undefined
): ViewElement {
    if (!right) return left
    // Two columns need about 36 cells each: a 14-cell label and its value.
    if (width < 72) {
        return ui.Box({ flexDirection: 'column', children: [left, right] })
    }
    const half = Math.floor(width / 2)
    return ui.Box({
        flexDirection: 'row',
        children: [
            ui.Box({ width: half, children: [left] }),
            ui.Box({ width: width - half, children: [right] }),
        ],
    })
}

/** A bordered notice: warnings, errors and pending work. */
export function callout(
    ui: CommonUi,
    tone: Tone,
    icon: string,
    text: string
): ViewElement {
    return ui.Box({
        borderStyle: 'round',
        borderColor: color(tone),
        paddingX: 1,
        children: [
            ui.Text({
                wrap: 'wrap',
                children: [
                    ui.Text({
                        color: color(tone),
                        weight: 'bold',
                        children: [`${icon} `],
                    }),
                    ui.Text({ color: color('text'), children: [text] }),
                ],
            }),
        ],
    })
}

/** A footer of plain hotkey buttons: `e evaluate   c compact …`. */
export function actionBar(
    ui: CommonUi,
    buttons: readonly ViewElement[]
): ViewElement {
    return ui.Box({
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: 3,
        children: [...buttons],
    })
}

export function pad(text: string, width: number): string {
    return text.length >= width ? text : text.padEnd(width)
}
