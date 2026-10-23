import {
    formatTokens,
    type ConfigurationPort,
    type ContextPilotController,
    type RuntimePort,
} from '@intelligent-compact/core'
import { contextPercent, percentText } from './band'
import { gaugeBar, gaugeLabels, type Run } from './gauge'
import {
    actionBar,
    blank,
    callout,
    contentWidth,
    field,
    fieldPair,
    line,
    pad,
    rule,
    section,
} from './primitives'
import { automationLabel } from './status'
import { automationTone, decisionTone, levelTone } from './theme'
import type {
    CommonUi,
    PaneLayout,
    ViewElement,
    ViewRenderPort,
} from './ui-port'

export interface DashboardContext {
    readonly ui: CommonUi
    readonly controller: ContextPilotController
    readonly runtime: RuntimePort
    readonly configuration: ConfigurationPort
    readonly render: ViewRenderPort
    readonly layout: PaneLayout
    readonly showStatusBand: boolean
    setStatusBand(visible: boolean): void
    reportError(error: unknown): void
    openPolicy(): void
    openHelp(): void
}

const LABEL = 14

function onOff(on: boolean): Run[] {
    return [{ text: on ? 'on' : 'off', tone: on ? 'good' : 'muted' }]
}

function value(text: string): Run[] {
    return [{ text, tone: 'text' }]
}

function total(usage: {
    input: number
    cacheRead: number
    cacheWrite: number
}): number {
    return usage.input + usage.cacheRead + usage.cacheWrite
}

function usageText(
    calls: number,
    cacheRead: number,
    prompt: number,
    output: number
): Run[] {
    if (calls === 0) return [{ text: 'no forks yet', tone: 'muted' }]
    const hit = prompt > 0 ? cacheRead / prompt : undefined
    return [
        { text: `${calls} call${calls === 1 ? '' : 's'}`, tone: 'text' },
        { text: '  ', tone: 'faint' },
        {
            text:
                hit === undefined
                    ? '— cached'
                    : `${(hit * 100).toFixed(1)}% cached`,
            tone: hit === undefined ? 'muted' : hit >= 0.7 ? 'good' : 'warn',
        },
        {
            text: `  ${output < 1000 ? output : formatTokens(output)} out`,
            tone: 'muted',
        },
    ]
}

function header(ctx: DashboardContext, width: number): ViewElement {
    const { ui, controller } = ctx
    const state = controller.snapshot
    const label = automationLabel(controller)
    const policy = state.resolvedPolicy
    const right: Run[] = []
    if (state.mode !== 'idle') {
        right.push({
            text: state.mode === 'probing' ? '◐ probing  ' : '◑ compacting  ',
            tone: state.mode === 'probing' ? 'warn' : 'accent',
        })
    }
    right.push({ text: `● ${label}`, tone: automationTone(label), bold: true })
    return ui.Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        width,
        children: [
            line(ui, [
                { text: '◆ ', tone: 'accent' },
                { text: 'context-pilot', tone: 'accent', bold: true },
                {
                    text: policy
                        ? `  ${policy.label} (${policy.id})`
                        : '  policy unresolved',
                    tone: 'muted',
                },
            ]),
            line(ui, right),
        ],
    })
}

function gauge(ctx: DashboardContext, width: number): ViewElement[] {
    const { ui } = ctx
    const state = ctx.controller.snapshot
    const policy = state.resolvedPolicy
    const { tokens, window } = state.context
    const percent = contextPercent(tokens, window, state.context.percent)
    const tone = levelTone(tokens, policy?.arm, policy?.mandatory)
    const input = {
        width,
        tokens,
        window,
        arm: policy?.arm,
        mandatory: policy?.mandatory,
        host:
            state.context.hostAutoCompactEnabled === true
                ? state.context.hostAutoCompactThreshold
                : undefined,
    }
    const summary: Run[] =
        tokens === undefined
            ? [
                  { text: '—', tone: 'muted', bold: true },
                  { text: ` / ${formatTokens(window)}`, tone: 'muted' },
                  { text: '   measured after the next reply', tone: 'faint' },
              ]
            : [
                  { text: formatTokens(tokens), tone: 'text', bold: true },
                  { text: ` / ${formatTokens(window)}`, tone: 'muted' },
                  { text: `  ${percentText(percent)}`, tone, bold: true },
              ]
    return [
        line(ui, summary),
        line(ui, gaugeBar(input)),
        line(ui, gaugeLabels(input)),
    ]
}

function stats(ctx: DashboardContext, width: number): ViewElement[] {
    const { ui } = ctx
    const state = ctx.controller.snapshot
    const policy = state.resolvedPolicy
    const cycle = state.cycle
    const growth = state.growth.snapshot()
    const progress =
        state.context.tokens !== undefined && cycle.startTokens !== undefined
            ? state.context.tokens - cycle.startTokens
            : undefined
    const progressDone =
        progress !== undefined &&
        policy !== undefined &&
        progress >= policy.minProgress
    let next: Run[] = [
        { text: formatTokens(state.nextProbeAt), tone: 'text', bold: true },
    ]
    if (cycle.suspended === 'budget') {
        next = [{ text: 'paused · budget spent', tone: 'warn' }]
    } else if (cycle.suspended === 'cache') {
        const mean = state.cache.mean()
        next = [
            {
                text: `paused · cache guard${mean === undefined ? '' : ` (${(mean * 100).toFixed(0)}%)`}`,
                tone: 'warn',
            },
        ]
    }
    const rows = [
        fieldPair(
            ui,
            width,
            field(ui, 'Next probe', next, LABEL),
            field(
                ui,
                'Growth',
                [
                    { text: `${formatTokens(growth.mean)}/turn`, tone: 'text' },
                    {
                        text: `  p90 ${formatTokens(growth.p90)}`,
                        tone: 'muted',
                    },
                ],
                LABEL
            )
        ),
        fieldPair(
            ui,
            width,
            field(
                ui,
                'Cycle',
                [
                    {
                        text: `probes ${cycle.probes}/${policy?.maxProbesPerCycle ?? '—'}`,
                        tone: 'text',
                    },
                    { text: `  turn ${state.turn}`, tone: 'muted' },
                ],
                LABEL
            ),
            field(
                ui,
                'Progress',
                [
                    {
                        text: formatTokens(progress),
                        tone: progressDone ? 'good' : 'text',
                    },
                    {
                        text: ` / ${formatTokens(policy?.minProgress)}`,
                        tone: 'muted',
                    },
                    ...(progressDone
                        ? [{ text: ' ✓', tone: 'good' as const }]
                        : []),
                ],
                LABEL
            )
        ),
    ]
    if (cycle.pending) {
        rows.push(
            callout(
                ui,
                'warn',
                '↻',
                `Retry ${cycle.pending.source} compaction at turn ${cycle.retryAtTurn ?? '—'} · ${cycle.failures} failure${cycle.failures === 1 ? '' : 's'}`
            )
        )
    }
    return rows
}

function decision(ctx: DashboardContext, width: number): ViewElement[] {
    const { ui } = ctx
    const state = ctx.controller.snapshot
    const rows: ViewElement[] = [
        section(ui, 'Decision', width),
        line(
            ui,
            [
                {
                    text: state.lastDecision,
                    tone: decisionTone(state.lastDecision),
                    bold: true,
                },
                ...(state.lastReason
                    ? [
                          { text: '  ', tone: 'faint' as const },
                          {
                              text: `reason ${state.lastReason}`,
                              tone: 'info' as const,
                          },
                      ]
                    : []),
            ],
            'wrap'
        ),
    ]
    if (state.lastDirective) {
        rows.push(
            line(ui, [
                { text: '↳ preserve ', tone: 'muted' },
                { text: `“${state.lastDirective}”`, tone: 'muted' },
            ])
        )
    }
    return rows
}

function policyRows(ctx: DashboardContext, width: number): ViewElement[] {
    const { ui } = ctx
    const policy = ctx.controller.snapshot.resolvedPolicy
    if (!policy) {
        return [
            section(ui, 'Policy', width),
            line(ui, [
                { text: 'No resolved policy is available.', tone: 'warn' },
            ]),
        ]
    }
    return [
        section(ui, 'Policy', width),
        fieldPair(
            ui,
            width,
            field(
                ui,
                'Probe gap',
                value(
                    `${formatTokens(policy.minGap)}–${formatTokens(policy.maxGap)}`
                ),
                LABEL
            ),
            field(
                ui,
                'Budget',
                value(`${policy.maxProbesPerCycle} probes/cycle`),
                LABEL
            )
        ),
        fieldPair(
            ui,
            width,
            field(
                ui,
                'Cache floor',
                value(`${(policy.cacheFloor * 100).toFixed(0)}%`),
                LABEL
            ),
            field(
                ui,
                'Min progress',
                value(formatTokens(policy.minProgress)),
                LABEL
            )
        ),
        fieldPair(
            ui,
            width,
            field(
                ui,
                'Headroom',
                value(formatTokens(policy.hostHeadroom)),
                LABEL
            ),
            field(
                ui,
                'Directive',
                value(`${policy.directiveMaxChars} chars`),
                LABEL
            )
        ),
        fieldPair(
            ui,
            width,
            field(ui, 'Fork forced', onOff(policy.forkOnMandatory), LABEL),
            field(ui, 'Inject', onOff(policy.injectNative), LABEL)
        ),
    ]
}

function activity(ctx: DashboardContext, width: number): ViewElement[] {
    const { ui } = ctx
    const state = ctx.controller.snapshot
    const cycleUsage = state.cycle.forkUsage
    const session = state.telemetry.session
    const lifetime = state.telemetry.lifetimeCounters()
    const rows: ViewElement[] = [
        section(ui, 'Activity', width),
        field(
            ui,
            'Session',
            usageText(
                state.forkUsage.calls,
                state.forkUsage.cacheRead,
                total(state.forkUsage),
                state.forkUsage.output
            ),
            LABEL
        ),
        field(
            ui,
            'This cycle',
            usageText(
                cycleUsage.calls,
                cycleUsage.cacheRead,
                total(cycleUsage),
                cycleUsage.output
            ),
            LABEL
        ),
        field(
            ui,
            'Counts',
            [
                {
                    text: `probes ${session.probes} · waits ${session.waits} · compacts ${session.compactions} · injections ${session.injections}`,
                    tone: 'text',
                },
            ],
            LABEL
        ),
    ]
    const issues = [
        ['parse failures', session.parseFailures],
        ['unavailable', session.forkUnavailable],
        ['budget', session.budgetExhausted],
        ['cache trips', session.cacheTrips],
        ['backoffs', session.backoffs],
    ].filter(([, count]) => (count as number) > 0)
    if (issues.length > 0) {
        rows.push(
            field(
                ui,
                'Issues',
                [
                    {
                        text: issues
                            .map(([name, count]) => `${name} ${count}`)
                            .join(' · '),
                        tone: 'warn',
                    },
                ],
                LABEL
            )
        )
    }
    rows.push(
        field(
            ui,
            'Lifetime',
            [
                {
                    text: `${lifetime.compactions} compaction${lifetime.compactions === 1 ? '' : 's'} · ${lifetime.probes} probe${lifetime.probes === 1 ? '' : 's'}`,
                    tone: 'muted',
                },
            ],
            LABEL
        )
    )
    const records = state.telemetry.lastCompactions(3)
    if (records.length === 0) {
        rows.push(
            line(ui, [{ text: '  no compactions recorded', tone: 'faint' }])
        )
    }
    for (const record of records) {
        const saved =
            record.after !== undefined && record.before > 0
                ? Math.round((1 - record.after / record.before) * 100)
                : undefined
        rows.push(
            line(ui, [
                { text: `  ${pad(record.source, 14)}`, tone: 'muted' },
                {
                    text: pad(
                        `${formatTokens(record.before)} → ${formatTokens(record.after)}`,
                        14
                    ),
                    tone: 'text',
                },
                {
                    text: pad(saved === undefined ? '' : `−${saved}%`, 7),
                    tone: 'good',
                },
                {
                    text: `${record.probes} probe${record.probes === 1 ? '' : 's'}`,
                    tone: 'muted',
                },
                ...(record.growthAfter === undefined
                    ? []
                    : [
                          {
                              text: ` · +${formatTokens(record.growthAfter)} after`,
                              tone: 'muted' as const,
                          },
                      ]),
            ])
        )
    }
    return rows
}

function actions(ctx: DashboardContext): ViewElement {
    const { ui, controller, configuration } = ctx
    const auto = controller.autoEnabled
    return actionBar(ui, [
        ui.Button({
            key: 'evaluate-now',
            label: 'evaluate',
            hotkey: 'e',
            plain: true,
            onPress: () => {
                void controller.evaluateNow(ctx.runtime)
            },
        }),
        ui.Button({
            key: 'compact-now',
            label: 'compact now',
            hotkey: 'c',
            plain: true,
            onPress: () => {
                void controller.compactNow(ctx.runtime)
            },
        }),
        ui.Button({
            key: 'toggle-auto',
            label: auto ? 'auto off' : 'auto on',
            hotkey: 'a',
            plain: true,
            onPress: () => {
                const next = !controller.autoEnabled
                controller.setAutoEnabled(next)
                void configuration.setAutoEnabled(next).catch(ctx.reportError)
            },
        }),
        ui.Button({
            key: 'configure',
            label: 'policy',
            hotkey: 'p',
            plain: true,
            onPress: () => ctx.openPolicy(),
        }),
        ui.Button({
            key: 'toggle-band',
            label: ctx.showStatusBand ? 'band off' : 'band on',
            hotkey: 'v',
            plain: true,
            dimColor: true,
            onPress: () => {
                const next = !ctx.showStatusBand
                ctx.setStatusBand(next)
                void configuration
                    .setShowStatusBand(next)
                    .catch(ctx.reportError)
            },
        }),
        ui.Button({
            key: 'help',
            label: 'help',
            hotkey: 'h',
            plain: true,
            dimColor: true,
            onPress: () => ctx.openHelp(),
        }),
    ])
}

export function renderDashboard(ctx: DashboardContext): ViewElement {
    const { ui } = ctx
    const state = ctx.controller.snapshot
    const width = contentWidth(ctx.layout)
    const alerts: ViewElement[] = [
        ...state.warnings.map((warning) => callout(ui, 'warn', '⚠', warning)),
        ...(state.lastError ? [callout(ui, 'bad', '✖', state.lastError)] : []),
    ]
    return ui.Box({
        flexDirection: 'column',
        paddingX: 1,
        children: [
            header(ctx, width),
            blank(ui),
            ...gauge(ctx, width),
            blank(ui),
            ...stats(ctx, width),
            ...(alerts.length > 0 ? [blank(ui), ...alerts] : []),
            blank(ui),
            ...decision(ctx, width),
            blank(ui),
            ...policyRows(ctx, width),
            blank(ui),
            ...activity(ctx, width),
            blank(ui),
            rule(ui, width),
            actions(ctx),
        ],
    })
}
