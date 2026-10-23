import type {
    ConfigurationPort,
    PolicyEditorState,
    PolicyRegistry,
    PolicyRegistryCodec,
    PolicyTextField,
    PolicyUnitField,
} from '@intelligent-compact/core'
import { SETTINGS_PANE_ID } from '../plugin-identity'
import {
    actionBar,
    blank,
    callout,
    contentWidth,
    line,
    rule,
    section,
} from './primitives'
import { color } from './theme'
import type {
    CommonUi,
    ConfigUi,
    PaneLayout,
    ViewElement,
    ViewNavigationPort,
    ViewRenderPort,
} from './ui-port'

export type SettingsTab = 'config' | 'registry' | 'help'

export interface SettingsContext {
    readonly registry: PolicyRegistry
    readonly codec: PolicyRegistryCodec
    readonly editor: PolicyEditorState
    readonly configuration: ConfigurationPort
    readonly render: ViewRenderPort
    readonly layout: PaneLayout
    readonly navigation?: ViewNavigationPort | undefined
}

export const HELP_SCHEMA = `{
  "schemaVersion": 2,
  "activePolicyId": "balanced",
  "policies": [{
    "id": "balanced",
    "label": "Balanced",
    "thresholds": {
      "arm": { "unit": "ratio", "value": 0.325 },
      "mandatory": { "unit": "ratio", "value": 0.5 },
      "hostHeadroom": { "unit": "ratio", "value": 0.1 }
    },
    "probe": {
      "minGap": { "unit": "tokens", "value": 10000 },
      "maxGap": { "unit": "tokens", "value": 40000 },
      "maxProbesPerCycle": 5,
      "cacheFloor": 0.7
    },
    "compaction": {
      "minProgress": { "unit": "ratio", "value": 0.15 },
      "directiveMaxChars": 1800,
      "forkOnMandatory": true,
      "injectNative": true,
      "baseInstructions": "Write a continuation summary that preserves working state, not history."
    }
  }]
}`

const FIELD_MEANINGS: readonly (readonly [string, string])[] = [
    [
        'schemaVersion',
        'Must be 2. Version 1 registries are rejected; re-save them as version 2.',
    ],
    ['activePolicyId', 'Selects one policy id from policies[].'],
    ['thresholds.arm', 'Earliest context fill where probes may start.'],
    [
        'thresholds.mandatory',
        'Hard AUTO compaction boundary; the fork cannot veto it.',
    ],
    [
        'thresholds.hostHeadroom',
        'Minimum distance between mandatory and the host autocompact threshold; a warning shows when it is smaller.',
    ],
    ['probe.minGap / maxGap', 'Clamp the next semantic probe point.'],
    [
        'probe.maxProbesPerCycle',
        'Integer 0..100 probes between compactions; 0 means compaction at mandatory only.',
    ],
    [
        'probe.cacheFloor',
        '0..1; probing pauses until the next compaction when the recent cache-read ratio falls below it.',
    ],
    [
        'compaction.minProgress',
        'Growth required since the last compaction before an automatic one may run.',
    ],
    [
        'compaction.directiveMaxChars',
        'Integer 1..8000, the preservation directive budget.',
    ],
    [
        'compaction.forkOnMandatory',
        'Spend one fork to write the directive at a forced compaction.',
    ],
    [
        'compaction.injectNative',
        "Add the policy instructions to the host's own compactions.",
    ],
    [
        'compaction.baseInstructions',
        'Always passed to the compactor; must not be empty.',
    ],
]

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function pretty(json: string): string {
    return JSON.stringify(JSON.parse(json), null, 2)
}

function close(ctx: SettingsContext): void {
    if (ctx.navigation) {
        void ctx.navigation.close({ id: SETTINGS_PANE_ID })
        return
    }
    ctx.editor.mode = 'dashboard'
    void ctx.render.invalidate()
}

function switchTab(ctx: SettingsContext, tab: SettingsTab): void {
    ctx.editor.mode = tab
    if (tab === 'registry') {
        ctx.editor.rawRegistryJson = pretty(ctx.codec.stringify(ctx.registry))
    }
    void ctx.render.invalidate()
}

function header(
    ui: CommonUi,
    ctx: SettingsContext,
    active: SettingsTab,
    width: number
): ViewElement[] {
    const tab = (mode: SettingsTab, label: string, hotkey: string) =>
        ui.Button({
            key: `tab-${mode}`,
            label: active === mode ? `● ${label}` : label,
            hotkey,
            plain: true,
            dimColor: active !== mode,
            onPress: () => switchTab(ctx, mode),
        })
    return [
        ui.Box({
            flexDirection: 'row',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            columnGap: 2,
            width,
            children: [
                line(ui, [
                    { text: '◆ ', tone: 'accent' },
                    { text: 'context-pilot', tone: 'accent', bold: true },
                    { text: '  settings', tone: 'muted' },
                ]),
                ui.Box({
                    flexDirection: 'row',
                    columnGap: 2,
                    children: [
                        tab('config', 'policy', 'p'),
                        tab('registry', 'json', 'r'),
                        tab('help', 'help', 'h'),
                        ui.Button({
                            key: 'close-settings',
                            label: 'close',
                            hotkey: 'x',
                            plain: true,
                            dimColor: true,
                            onPress: () => close(ctx),
                        }),
                    ],
                }),
            ],
        }),
        rule(ui, width),
    ]
}

function errorCallout(ui: CommonUi, ctx: SettingsContext): ViewElement[] {
    if (ctx.editor.error)
        return [
            callout(ui, 'bad', '✖', `Configuration error: ${ctx.editor.error}`),
        ]
    return ctx.editor.notice
        ? [callout(ui, 'good', '✓', ctx.editor.notice)]
        : []
}

/**
 * Writes the registry. The notice is set first: the write reloads the
 * plugin, and the reloaded copy shows what the session carried.
 */
async function commit(
    ctx: SettingsContext,
    json: string,
    notice: string,
    select = ctx.editor.selectedPolicyId
): Promise<void> {
    const { editor } = ctx
    const previous = editor.selectedPolicyId
    editor.error = undefined
    editor.notice = notice
    editor.selectedPolicyId = select
    try {
        await ctx.configuration.saveRegistryJson(json)
    } catch (error) {
        editor.notice = undefined
        editor.selectedPolicyId = previous
        editor.error = message(error)
    }
    await ctx.render.invalidate()
}

function appliedNote(isActive: boolean): string {
    return isActive ? 'applied to this session' : 'not the active policy'
}

function hint(ui: CommonUi, text: string): ViewElement {
    return ui.Text({ color: color('muted'), wrap: 'wrap', children: [text] })
}

export function renderConfig(ui: ConfigUi, ctx: SettingsContext): ViewElement {
    const { editor, registry, codec, render } = ctx
    const d = editor.draft
    const width = contentWidth(ctx.layout)
    const activeId = registry.active().id
    const unitOptions = [
        { value: 'tokens', label: 'tokens' },
        { value: 'ratio', label: 'ratio' },
    ]
    const fail = async (error: unknown) => {
        editor.error = message(error)
        await render.invalidate()
    }
    const input = (key: PolicyTextField, label: string, value: string) =>
        ui.Input({
            key: `field-${key}`,
            label,
            value,
            onInput: (next: string) => {
                editor.updateText(key, next)
                void render.invalidate()
            },
            onSubmit: (next: string) => {
                editor.updateText(key, next)
                void render.invalidate()
            },
        })
    const unit = (key: PolicyUnitField, value: string) =>
        ui.Select({
            key: `unit-${key}`,
            value,
            options: unitOptions,
            onSelect: (next: string) => {
                try {
                    editor.updateUnit(key, next)
                    editor.error = undefined
                } catch (error) {
                    editor.error = message(error)
                }
                void render.invalidate()
            },
        })
    const measured = (
        key: PolicyTextField,
        label: string,
        value: string,
        unitKey: PolicyUnitField,
        unitValue: string
    ) =>
        ui.Box({
            flexDirection: 'row',
            columnGap: 2,
            children: [
                ui.Box({ flexGrow: 1, children: [input(key, label, value)] }),
                ui.Box({ width: 12, children: [unit(unitKey, unitValue)] }),
            ],
        })
    const toggle = (
        key: string,
        hotkey: string,
        label: string,
        on: boolean,
        flip: () => void
    ) =>
        ui.Button({
            key,
            hotkey,
            plain: true,
            onPress: () => {
                flip()
                void render.invalidate()
            },
            children: [
                `${label} `,
                ui.Text({
                    color: color(on ? 'good' : 'muted'),
                    weight: 'bold',
                    children: [on ? '● on' : '○ off'],
                }),
            ],
        })

    const save = async () => {
        try {
            const definition = editor.toDefinition()
            let next = registry.replace(definition)
            if (definition.id !== editor.selectedPolicyId)
                next = next.activate(definition.id)
            await commit(
                ctx,
                codec.stringify(next),
                `Saved ${definition.id} · ${appliedNote(next.activePolicyId === definition.id)}`,
                definition.id
            )
        } catch (error) {
            await fail(error)
        }
    }
    const activate = async () => {
        try {
            const id = editor.selectedPolicyId
            await commit(
                ctx,
                codec.stringify(registry.activate(id)),
                `${id} is now the active policy`
            )
        } catch (error) {
            await fail(error)
        }
    }
    const clone = async () => {
        try {
            const next = registry.clone(editor.selectedPolicyId, editor.cloneId)
            await commit(
                ctx,
                codec.stringify(next),
                `Cloned ${editor.cloneId} · activate it to use it`,
                editor.cloneId
            )
        } catch (error) {
            await fail(error)
        }
    }

    return ui.Box({
        flexDirection: 'column',
        paddingX: 1,
        children: [
            ...header(ui, ctx, 'config', width),
            hint(
                ui,
                'Policy registry editor · values are data, not code constants'
            ),
            blank(ui),
            ui.Box({
                flexDirection: 'row',
                columnGap: 2,
                children: [
                    ui.Box({
                        flexGrow: 1,
                        children: [
                            ui.Select({
                                key: 'policy-select',
                                label: 'Policy',
                                value: editor.selectedPolicyId,
                                options: registry.list().map((policy) => ({
                                    value: policy.id,
                                    label: `${policy.label} (${policy.id})`,
                                })),
                                onSelect: (id: string) => {
                                    try {
                                        editor.select(registry, id)
                                    } catch (error) {
                                        editor.error = message(error)
                                    }
                                    void render.invalidate()
                                },
                            }),
                        ],
                    }),
                    line(ui, [
                        editor.selectedPolicyId === activeId
                            ? { text: '● active', tone: 'good', bold: true }
                            : { text: '○ inactive', tone: 'muted' },
                    ]),
                ],
            }),
            input('label', 'Label', d.label),
            hint(
                ui,
                `id ${d.id} · fixed here; clone or edit the JSON to rename`
            ),
            blank(ui),
            section(ui, 'Thresholds', width, 'ratio = share of the window'),
            measured('armValue', 'Arm', d.armValue, 'armUnit', d.armUnit),
            measured(
                'mandatoryValue',
                'Mandatory',
                d.mandatoryValue,
                'mandatoryUnit',
                d.mandatoryUnit
            ),
            measured(
                'hostHeadroomValue',
                'Host headroom',
                d.hostHeadroomValue,
                'hostHeadroomUnit',
                d.hostHeadroomUnit
            ),
            hint(
                ui,
                'Probes start at arm · compaction is forced at mandatory · keep headroom below the host autocompact'
            ),
            blank(ui),
            section(ui, 'Probe', width),
            measured(
                'minGapValue',
                'Min gap',
                d.minGapValue,
                'minGapUnit',
                d.minGapUnit
            ),
            measured(
                'maxGapValue',
                'Max gap',
                d.maxGapValue,
                'maxGapUnit',
                d.maxGapUnit
            ),
            input('maxProbesPerCycle', 'Probes per cycle', d.maxProbesPerCycle),
            input('cacheFloor', 'Cache floor (0–1)', d.cacheFloor),
            hint(
                ui,
                '0 probes per cycle = compact only at mandatory · probing pauses when cache reads fall below the floor'
            ),
            blank(ui),
            section(ui, 'Compaction', width),
            measured(
                'minProgressValue',
                'Min progress',
                d.minProgressValue,
                'minProgressUnit',
                d.minProgressUnit
            ),
            input(
                'directiveMaxChars',
                'Directive max chars',
                d.directiveMaxChars
            ),
            input('baseInstructions', 'Instructions', d.baseInstructions),
            actionBar(ui, [
                toggle(
                    'fork-mandatory',
                    'f',
                    'fork at mandatory',
                    d.forkOnMandatory,
                    () => editor.toggleForkOnMandatory()
                ),
                toggle(
                    'inject-native',
                    'n',
                    'inject into /compact',
                    d.injectNative,
                    () => editor.toggleInjectNative()
                ),
            ]),
            blank(ui),
            ...errorCallout(ui, ctx),
            rule(ui, width),
            actionBar(ui, [
                ui.Button({
                    key: 'save-policy',
                    label: 'save policy',
                    hotkey: 's',
                    variant: 'primary',
                    plain: true,
                    onPress: () => {
                        void save()
                    },
                }),
                ui.Button({
                    key: 'activate-policy',
                    label: 'activate',
                    hotkey: 'a',
                    plain: true,
                    onPress: () => {
                        void activate()
                    },
                }),
            ]),
            ui.Input({
                key: 'clone-id',
                label: 'Clone as',
                placeholder: 'new-policy-id',
                value: editor.cloneId,
                onInput: (value: string) => {
                    editor.cloneId = value
                },
                onSubmit: (value: string) => {
                    editor.cloneId = value
                    void clone()
                },
                submitLabel: 'clone',
            }),
            hint(ui, 'tab moves focus · enter applies · esc closes'),
        ],
    })
}

export function renderRegistry(
    ui: ConfigUi,
    ctx: SettingsContext
): ViewElement {
    const { editor, codec, render } = ctx
    const width = contentWidth(ctx.layout)
    let status: ViewElement
    try {
        const parsed = codec.parse(editor.rawRegistryJson)
        const count = parsed.list().length
        status = line(ui, [
            { text: '✓ valid', tone: 'good', bold: true },
            {
                text: `  ${count} polic${count === 1 ? 'y' : 'ies'} · active ${parsed.active().id}`,
                tone: 'muted',
            },
        ])
    } catch (error) {
        status = line(
            ui,
            [
                { text: '✖ invalid', tone: 'bad', bold: true },
                { text: `  ${message(error)}`, tone: 'muted' },
            ],
            'wrap'
        )
    }
    const saveRaw = async () => {
        try {
            const parsed = codec.parse(editor.rawRegistryJson)
            await commit(
                ctx,
                codec.stringify(parsed),
                `Registry saved · ${parsed.activePolicyId} is active`
            )
        } catch (error) {
            editor.error = message(error)
            await render.invalidate()
        }
    }
    return ui.Box({
        flexDirection: 'column',
        paddingX: 1,
        children: [
            ...header(ui, ctx, 'registry', width),
            hint(
                ui,
                'Advanced registry JSON · validated before it is saved · several policies supported'
            ),
            blank(ui),
            ui.Box({
                borderStyle: 'round',
                borderColor: color('faint'),
                paddingX: 1,
                children: [
                    ui.Input({
                        key: 'registry-json',
                        label: 'JSON',
                        value: editor.rawRegistryJson,
                        rows: 14,
                        onInput: (value: string) => {
                            editor.rawRegistryJson = value
                            editor.notice = undefined
                            void render.invalidate()
                        },
                        onSubmit: () => {
                            void saveRaw()
                        },
                        submitLabel: 'save',
                    }),
                ],
            }),
            status,
            blank(ui),
            ...errorCallout(ui, ctx),
            rule(ui, width),
            actionBar(ui, [
                ui.Button({
                    key: 'save-raw',
                    label: 'validate & save',
                    hotkey: 's',
                    variant: 'primary',
                    plain: true,
                    onPress: () => {
                        void saveRaw()
                    },
                }),
                ui.Button({
                    key: 'back-config',
                    label: 'back to policy',
                    hotkey: 'b',
                    plain: true,
                    dimColor: true,
                    onPress: () => switchTab(ctx, 'config'),
                }),
            ]),
        ],
    })
}

export function renderHelp(ui: ConfigUi, ctx: SettingsContext): ViewElement {
    const width = contentWidth(ctx.layout)
    const step = (n: string, text: string) =>
        ui.Box({
            flexDirection: 'row',
            children: [
                ui.Box({
                    width: 3,
                    flexShrink: 0,
                    children: [
                        ui.Text({
                            color: color('accent'),
                            weight: 'bold',
                            children: [n],
                        }),
                    ],
                }),
                ui.Box({
                    width: width - 3,
                    children: [
                        ui.Text({
                            color: color('text'),
                            wrap: 'wrap',
                            children: [text],
                        }),
                    ],
                }),
            ],
        })
    const definition = (name: string, text: string, nameWidth: number) =>
        ui.Box({
            flexDirection: 'row',
            children: [
                ui.Box({
                    width: nameWidth,
                    flexShrink: 0,
                    children: [
                        ui.Text({
                            color: color('info'),
                            wrap: 'truncate',
                            children: [name],
                        }),
                    ],
                }),
                ui.Box({
                    width: width - nameWidth,
                    children: [
                        ui.Text({
                            color: color('text'),
                            wrap: 'wrap',
                            children: [text],
                        }),
                    ],
                }),
            ],
        })
    return ui.Box({
        flexDirection: 'column',
        paddingX: 1,
        children: [
            ...header(ui, ctx, 'help', width),
            hint(
                ui,
                'Configuration and control-loop reference · full text in docs/CONFIGURATION.md'
            ),
            blank(ui),
            section(ui, 'Control flow', width),
            step('1', 'A finished main-thread turn measures the context fill.'),
            step(
                '2',
                'Below arm nothing runs. Between arm and mandatory a budgeted fork answers WAIT or COMPACT and writes what to preserve.'
            ),
            step(
                '3',
                'At mandatory, or one p90 turn before it, AUTO compacts with one directive fork; the fork cannot veto it.'
            ),
            step(
                '4',
                'Right after a compaction, minProgress growth is required before the next automatic one.'
            ),
            blank(ui),
            section(ui, 'Modes', width),
            definition(
                'AUTO',
                'Probes and compactions run after main-thread turns.',
                14
            ),
            definition(
                'MANUAL',
                'auto_enabled=false: nothing forks or compacts automatically.',
                14
            ),
            definition(
                'OBSERVE',
                'AUTO is on but the session is headless and cannot run plugin compaction; the controller only measures and injects instructions into native compactions.',
                14
            ),
            definition(
                'evaluate',
                'Dry run: one decision fork shows WAIT or COMPACT with the reason; nothing executes.',
                14
            ),
            definition(
                'compact now',
                'Compacts in any mode where the host can compact.',
                14
            ),
            blank(ui),
            section(
                ui,
                'Registry shape',
                width,
                'example values are illustrative'
            ),
            ui.Code({ source: HELP_SCHEMA, language: 'json' }),
            blank(ui),
            section(ui, 'Field meanings', width),
            ...FIELD_MEANINGS.map(([name, text]) =>
                definition(name, text, Math.min(30, Math.floor(width * 0.42)))
            ),
            blank(ui),
            hint(
                ui,
                'Thresholds accept { "unit": "tokens", "value": N } with N > 0, or { "unit": "ratio", "value": r } with 0 < r <= 1. Ordering: arm < mandatory <= window; minGap <= maxGap; minProgress < mandatory.'
            ),
            blank(ui),
            rule(ui, width),
            actionBar(ui, [
                ui.Button({
                    key: 'back-config',
                    label: 'policy editor',
                    hotkey: 'b',
                    plain: true,
                    onPress: () => switchTab(ctx, 'config'),
                }),
            ]),
        ],
    })
}

export function renderUnsupported(
    ui: CommonUi,
    ctx: SettingsContext
): ViewElement {
    return ui.Box({
        flexDirection: 'column',
        paddingX: 1,
        children: [
            line(ui, [
                { text: '◆ ', tone: 'accent' },
                { text: 'context-pilot', tone: 'accent', bold: true },
                { text: '  settings', tone: 'muted' },
            ]),
            blank(ui),
            hint(
                ui,
                'This surface does not provide Input/Select controls. Configure from terminal, desktop, or VS Code, or use Claude Code /config.'
            ),
            blank(ui),
            ui.Button({
                key: 'back-dashboard',
                label: 'close',
                hotkey: 'b',
                plain: true,
                dimColor: true,
                onPress: () => close(ctx),
            }),
        ],
    })
}
