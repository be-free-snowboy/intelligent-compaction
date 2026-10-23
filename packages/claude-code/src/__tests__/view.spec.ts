import { describe, expect, it } from 'vitest'
import {
    ContextPilotController,
    ContextPilotState,
    InstructionComposer,
    PolicyRegistry,
    PolicyRegistryCodec,
    ProbeDecisionParser,
    ProbeScheduler,
    SemanticProbePromptFactory,
    type CompactResult,
    type ConfigurationPort,
    type ContextSnapshot,
    type ForkOutcome,
    type RuntimePort,
    type TelemetryData,
} from '@intelligent-compact/core'
import { ContextPilotView } from '../presentation/view'
import type {
    CommonUi,
    ConfigUi,
    ViewElement,
    ViewNavigationPort,
    ViewRenderPort,
} from '../presentation/ui-port'

type FakeElement = {
    type: string
    props: Record<string, unknown>
}

const element =
    (type: string) =>
    (props: Record<string, unknown>): FakeElement => ({ type, props })

function makeUi(withConfig = true): Record<string, unknown> {
    return {
        Box: element('Box'),
        Text: element('Text'),
        Button: element('Button'),
        Code: element('Code'),
        ...(withConfig
            ? { Input: element('Input'), Select: element('Select') }
            : {}),
    }
}

function required<T>(value: T | undefined, label: string): T {
    if (value === undefined) throw new Error(`Missing ${label}`)
    return value
}

function invoke(
    target: FakeElement | undefined,
    property: string,
    ...args: unknown[]
): void {
    const item = required(target, property)
    const handler = item.props[property]
    if (typeof handler !== 'function') {
        throw new Error(`${property} is not callable`)
    }
    ;(handler as (...values: unknown[]) => void)(...args)
}

const policyData = {
    id: 'test',
    label: 'Test policy',
    thresholds: {
        arm: { unit: 'tokens' as const, value: 325_000 },
        mandatory: { unit: 'tokens' as const, value: 500_000 },
        hostHeadroom: { unit: 'tokens' as const, value: 50_000 },
    },
    probe: {
        minGap: { unit: 'tokens' as const, value: 5_000 },
        maxGap: { unit: 'tokens' as const, value: 50_000 },
        maxProbesPerCycle: 5,
        cacheFloor: 0.7,
    },
    compaction: {
        minProgress: { unit: 'tokens' as const, value: 50_000 },
        directiveMaxChars: 900,
        forkOnMandatory: true,
        injectNative: true,
        baseInstructions: 'Preserve task state.',
    },
}

function setup() {
    const registry = new PolicyRegistry({
        schemaVersion: 2,
        activePolicyId: 'test',
        policies: [policyData],
    })
    const controller = new ContextPilotController(
        registry,
        new ContextPilotState(),
        {
            parser: new ProbeDecisionParser(),
            scheduler: new ProbeScheduler(),
            prompts: new SemanticProbePromptFactory(),
            composer: new InstructionComposer(),
        },
        { autoEnabled: true, hostCanCompact: true }
    )
    const codec = new PolicyRegistryCodec()
    const view = new ContextPilotView(
        controller,
        registry,
        codec,
        codec.stringify(registry),
        { showStatusBand: true }
    )
    const live: { context: ContextSnapshot } = {
        context: { tokens: 350_000, window: 1_000_000 },
    }
    const replies: ForkOutcome[] = []
    const compactResults: CompactResult[] = []
    const telemetrySaved: TelemetryData[] = []
    const runtime: RuntimePort = {
        readContext: async () => live.context,
        fork: async () =>
            replies.shift() ?? {
                kind: 'unavailable',
                reason: 'nothing-to-fork',
            },
        compact: async () =>
            compactResults.shift() ?? {
                tokensBefore: live.context.tokens,
                tokensAfter: 100_000,
            },
        sessionId: async () => 'session',
        toast: async () => {},
        invalidateUi: async () => {},
        saveTelemetry: async (data) => {
            telemetrySaved.push(data)
        },
    }
    const saved: string[] = []
    const auto: boolean[] = []
    const band: boolean[] = []
    const configuration: ConfigurationPort = {
        saveRegistryJson: async (json) => {
            saved.push(json)
        },
        setAutoEnabled: async (enabled) => {
            auto.push(enabled)
        },
        setShowStatusBand: async (enabled) => {
            band.push(enabled)
        },
    }
    const opened: unknown[] = []
    const closed: string[] = []
    const navigation: ViewNavigationPort = {
        open: async (request) => {
            opened.push(request)
        },
        close: async (request) => {
            closed.push(request.id)
        },
        invalidate: async () => {},
    }
    const render: ViewRenderPort = { invalidate: async () => {} }

    return {
        controller,
        registry,
        view,
        runtime,
        live,
        replies,
        compactResults,
        telemetrySaved,
        configuration,
        saved,
        auto,
        band,
        opened,
        closed,
        navigation,
        render,
    }
}

function findAll(
    node: unknown,
    type: string,
    result: FakeElement[] = []
): FakeElement[] {
    if (Array.isArray(node)) {
        for (const child of node) findAll(child, type, result)
        return result
    }
    if (typeof node !== 'object' || node === null) return result
    const nodeElement = node as FakeElement
    if (nodeElement.type === type) result.push(nodeElement)
    if (nodeElement.props?.children) {
        findAll(nodeElement.props.children, type, result)
    }
    return result
}

function textOf(node: unknown): string {
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (typeof node === 'string' || typeof node === 'number') {
        return String(node)
    }
    if (typeof node !== 'object' || node === null) return ''
    const nodeElement = node as FakeElement
    return textOf(nodeElement.props?.children)
}

describe('ContextPilotView', () => {
    it('renders and hides the status band', () => {
        const { view, controller, registry } = setup()
        controller.snapshot.context = {
            tokens: 350_000,
            window: 1_000_000,
        }
        controller.snapshot.resolvedPolicy = registry
            .active()
            .resolve(1_000_000)
        const ui = makeUi() as unknown as CommonUi
        const downstream = { type: 'downstream' } as unknown as ViewElement

        const withBand = view.renderAbovePrompt(ui, downstream)
        expect(textOf(withBand)).toContain('context-pilot test')
        expect(textOf(withBand)).toContain('AUTO')

        view.setStatusBandVisible(false)
        expect(view.renderAbovePrompt(ui, downstream)).toBe(downstream)
    })

    it('opens the dashboard and renders controller state', () => {
        const { view, controller, registry } = setup()
        controller.snapshot.context = {
            tokens: 450_000,
            window: 1_000_000,
            percent: 45,
            hostAutoCompactThreshold: 450_000,
            hostAutoCompactEnabled: true,
        }
        controller.snapshot.resolvedPolicy = registry
            .active()
            .resolve(1_000_000)
        controller.snapshot.nextProbeAt = 455_000
        controller.snapshot.lastDecision = 'WAIT; next semantic probe at 455k'
        controller.snapshot.lastDirective = 'keep the unresolved hypothesis'
        controller.snapshot.lastCompaction = {
            before: 500_000,
            after: 120_000,
            source: 'manual-compact',
        }
        controller.snapshot.warnings = [
            'Host autocompact at 450k can pre-empt mandatory 500k',
        ]
        controller.snapshot.recordForkUsage({
            input: 10,
            output: 2,
            cacheRead: 90,
            cacheWrite: 0,
        })

        const ui = makeUi() as unknown as CommonUi
        const rendered = view.renderPane(
            ui,
            ui as unknown as ConfigUi,
            {} as RuntimePort,
            {} as ConfigurationPort,
            { invalidate: async () => {} }
        )
        const text = textOf(rendered)
        expect(text).toContain('450k / 1.00M  45%')
        expect(text).toContain('Test policy (test)')
        expect(text).toContain('arm 325k')
        expect(text).toContain('mandatory 500k')
        expect(text).toContain('Headroom')
        expect(text).toContain('5 probes/cycle')
        expect(text).toContain('Cache floor')
        expect(text).toContain('Min progress')
        expect(text).toContain('Inject')
        expect(text).toContain('Host autocompact at 450k can pre-empt')
        expect(text).not.toContain('native autocompact')
        expect(text).toContain('↳ preserve “keep the unresolved hypothesis”')
        expect(text).toContain('90.0% cached')

        expect(
            findAll(rendered, 'Button').map((item) => item.props.key)
        ).toEqual([
            'evaluate-now',
            'compact-now',
            'toggle-auto',
            'configure',
            'toggle-band',
            'help',
        ])
        expect(
            findAll(rendered, 'Button').map((item) => item.props.label)
        ).toContain('evaluate')
    })

    it('labels the automation mode in the band and dashboard', () => {
        const { view, controller, registry } = setup()
        controller.snapshot.context = { tokens: 350_000, window: 1_000_000 }
        controller.snapshot.resolvedPolicy = registry
            .active()
            .resolve(1_000_000)
        const ui = makeUi() as unknown as CommonUi
        const downstream = { type: 'downstream' } as unknown as ViewElement
        const band = () =>
            view.renderAbovePrompt(ui, downstream) as unknown as FakeElement
        const dashboard = () =>
            textOf(
                view.renderPane(
                    ui,
                    ui as unknown as ConfigUi,
                    {} as RuntimePort,
                    {} as ConfigurationPort,
                    { invalidate: async () => {} }
                )
            )
        const labelColor = (name: string) =>
            findAll(band(), 'Text').find(
                (item) => textOf(item.props.children) === `● ${name}`
            )?.props.color

        expect(textOf(band())).toContain('probes 0/5')
        expect(labelColor('AUTO')).toBe('success')
        expect(dashboard()).toContain('● AUTO')

        controller.setHostCanCompact(false)
        expect(labelColor('OBSERVE')).toBe('inactive')
        expect(dashboard()).toContain('● OBSERVE')

        controller.setAutoEnabled(false)
        expect(labelColor('MANUAL')).toBe('warning')
        expect(dashboard()).toContain('● MANUAL')
    })

    it('marks warnings and errors in the band and fits narrow widths', () => {
        const { view, controller, registry } = setup()
        controller.snapshot.context = { tokens: 350_000, window: 1_000_000 }
        controller.snapshot.resolvedPolicy = registry
            .active()
            .resolve(1_000_000)
        const ui = makeUi() as unknown as CommonUi
        const downstream = { type: 'downstream' } as unknown as ViewElement
        const render = (columns?: number) =>
            view.renderAbovePrompt(ui, downstream, columns)

        expect(textOf(render())).not.toContain('⚠')
        controller.snapshot.warnings = ['host autocompact is close']
        expect(textOf(render())).toContain('⚠ warn')
        controller.snapshot.lastError = 'boom'
        expect(textOf(render())).toContain('✖ error')
        expect(textOf(render())).not.toContain('⚠')

        const narrow = textOf(render(40))
        expect(narrow).not.toContain('probes')
        expect(narrow).not.toContain('next')
        expect(narrow).toContain('✖ error')
        const row = findAll(render(40), 'Text').find(
            (item) => item.props.wrap === 'truncate'
        )
        expect(row).toBeDefined()
    })

    it('renders growth, cycle, reason and telemetry after a real probe', async () => {
        const { view, controller, runtime, live, replies } = setup()
        const ui = makeUi() as unknown as CommonUi
        const dashboard = () =>
            textOf(
                view.renderPane(
                    ui,
                    ui as unknown as ConfigUi,
                    {} as RuntimePort,
                    {} as ConfigurationPort,
                    { invalidate: async () => {} }
                )
            )

        await controller.initialize(runtime)
        let text = dashboard()
        expect(text).toContain('Cycle')
        expect(text).toContain('Activity')
        expect(text).toContain('—/turn')
        expect(text).toContain('p90 —')
        expect(text).toContain('probes 0/5  turn 0')
        expect(text).toContain('— / 50k')
        expect(text).not.toContain('Retry')
        expect(text).toContain('no forks yet')
        expect(text).toContain('no compactions recorded')
        expect(text).not.toContain('reason ')

        for (const tokens of [340_000, 350_000, 360_000, 370_000]) {
            live.context = { tokens, window: 1_000_000 }
            replies.push({
                kind: 'answered',
                text: '{"a":"W","n":999999,"r":"edit"}',
                usage: { input: 1, output: 2, cacheRead: 90, cacheWrite: 0 },
            })
            controller.snapshot.nextProbeAt = 0
            await controller.onMainTurnComplete(runtime)
        }
        text = dashboard()
        expect(text).toContain('10k/turn')
        expect(text).toContain('p90 10k')
        expect(text).toContain('probes 4/5  turn 4')
        expect(text).toContain('reason edit')
        expect(text).toContain('probes 4 · waits 4 · compacts 0')
        expect(text).toContain('0 compactions · 4 probes')
        expect(text.split('4 calls').length - 1).toBe(2)
        expect(text).toContain('98.9% cached')
        expect(text.indexOf('Next probe')).toBeLessThan(
            text.indexOf('Decision')
        )
        expect(text.indexOf('Decision')).toBeLessThan(text.indexOf('Policy'))
        expect(text.indexOf('Policy')).toBeLessThan(text.indexOf('Activity'))

        controller.snapshot.cycle.suspended = 'budget'
        expect(dashboard()).toContain('paused · budget spent')
        controller.snapshot.cycle.suspended = 'cache'
        expect(dashboard()).toContain('paused · cache guard (99%)')
    })

    it('shows the pending attempt, then the compaction records', async () => {
        const {
            view,
            controller,
            runtime,
            live,
            compactResults,
            telemetrySaved,
        } = setup()
        const ui = makeUi() as unknown as CommonUi
        const dashboard = () =>
            textOf(
                view.renderPane(
                    ui,
                    ui as unknown as ConfigUi,
                    {} as RuntimePort,
                    {} as ConfigurationPort,
                    { invalidate: async () => {} }
                )
            )
        await controller.initialize(runtime)

        live.context = { tokens: 520_000, window: 1_000_000 }
        compactResults.push({ skip: 'busy' })
        await controller.onMainTurnComplete(runtime)
        let text = dashboard()
        expect(text).toContain(
            'Retry mandatory compaction at turn 2 · 1 failure'
        )
        expect(text).toContain('Compaction skipped: busy')
        expect(text).toContain('backoffs 1')

        await controller.onMainTurnComplete(runtime)
        text = dashboard()
        expect(text).not.toContain('Retry mandatory')
        expect(text).toContain('unavailable 1')
        expect(text).toContain('compacts 1')
        expect(text).toContain('1 compaction · 0 probes')
        expect(text).toContain('520k → 100k')
        expect(text).toContain('−81%')
        expect(telemetrySaved).toHaveLength(1)
    })

    it('shows warning cards from the controller instead of the old native check', async () => {
        const { view, controller, runtime, live } = setup()
        live.context = {
            tokens: 350_000,
            window: 1_000_000,
            hostAutoCompactThreshold: 520_000,
            hostAutoCompactEnabled: true,
        }
        await controller.initialize(runtime)
        const ui = makeUi() as unknown as CommonUi
        const rendered = view.renderPane(
            ui,
            ui as unknown as ConfigUi,
            {} as RuntimePort,
            {} as ConfigurationPort,
            { invalidate: async () => {} }
        )
        const cards = findAll(rendered, 'Box').filter(
            (item) => item.props.borderColor === 'warning'
        )
        expect(cards).toHaveLength(1)
        expect(textOf(cards[0])).toContain('Host autocompact at 520k')
    })

    it('opens and renders the guided policy editor', async () => {
        const {
            view,
            controller,
            configuration,
            auto,
            band,
            navigation,
            render,
        } = setup()
        await view.openDashboard(navigation)

        const ui = makeUi() as unknown as CommonUi
        const configUi = ui as unknown as ConfigUi
        const dashboard = view.renderPane(
            ui,
            configUi,
            {} as RuntimePort,
            configuration,
            render,
            { columns: 88, rows: 26 },
            'dashboard',
            navigation
        )
        const buttons = findAll(dashboard, 'Button')
        const configure = buttons.find((item) => item.props.key === 'configure')
        invoke(configure, 'onPress')

        const config = view.renderPane(
            ui,
            configUi,
            {} as RuntimePort,
            configuration,
            render,
            { columns: 88, rows: 26 },
            'settings',
            navigation
        )
        expect(textOf(config)).toContain('Policy registry editor')
        expect(
            findAll(config, 'Input').map((item) => item.props.key)
        ).toContain('field-label')
        expect(
            findAll(config, 'Select').map((item) => item.props.key)
        ).toContain('unit-armUnit')

        const toggleAuto = buttons.find(
            (item) => item.props.key === 'toggle-auto'
        )
        invoke(toggleAuto, 'onPress')
        await Promise.resolve()
        expect(controller.autoEnabled).toBe(false)
        expect(auto).toEqual([false])

        const toggleBand = buttons.find(
            (item) => item.props.key === 'toggle-band'
        )
        invoke(toggleBand, 'onPress')
        await Promise.resolve()
        expect(band).toEqual([false])
    })

    it('edits and persists every guided configuration control', async () => {
        const {
            view,
            registry,
            configuration,
            saved,
            navigation,
            render,
            closed,
        } = setup()
        await view.openConfig(navigation)
        const ui = makeUi() as unknown as CommonUi
        const configUi = ui as unknown as ConfigUi
        const renderPane = () =>
            view.renderPane(
                ui,
                configUi,
                {} as RuntimePort,
                configuration,
                render,
                { columns: 88, rows: 26 },
                'settings',
                navigation
            )

        let config = renderPane()
        const input = (key: string) =>
            required(
                findAll(config, 'Input').find((item) => item.props.key === key),
                key
            )
        const select = (key: string) =>
            required(
                findAll(config, 'Select').find(
                    (item) => item.props.key === key
                ),
                key
            )
        const button = (key: string) =>
            required(
                findAll(config, 'Button').find(
                    (item) => item.props.key === key
                ),
                key
            )

        const edit = (key: string, value: string) => {
            invoke(input(`field-${key}`), 'onInput', value)
            invoke(input(`field-${key}`), 'onSubmit', value)
        }

        invoke(select('policy-select'), 'onSelect', 'test')
        edit('label', 'Renamed policy')
        edit('armValue', '350000')
        edit('mandatoryValue', '550000')
        edit('hostHeadroomValue', '60000')
        edit('maxProbesPerCycle', '3')
        edit('cacheFloor', '0.5')
        edit('minProgressValue', '60000')
        edit('minGapValue', '6000')
        edit('maxGapValue', '60000')
        edit('directiveMaxChars', '500')
        edit('baseInstructions', 'Preserve this state.')
        for (const key of [
            'armUnit',
            'mandatoryUnit',
            'hostHeadroomUnit',
            'minGapUnit',
            'maxGapUnit',
            'minProgressUnit',
        ]) {
            invoke(select(`unit-${key}`), 'onSelect', 'tokens')
        }
        invoke(button('inject-native'), 'onPress')
        invoke(button('fork-mandatory'), 'onPress')

        invoke(input('clone-id'), 'onInput', 'copy')
        invoke(input('clone-id'), 'onSubmit', 'copy')
        await Promise.resolve()
        expect(saved.length).toBe(1)

        config = renderPane()
        invoke(button('save-policy'), 'onPress')
        await Promise.resolve()
        expect(saved.length).toBe(2)

        config = renderPane()
        invoke(button('activate-policy'), 'onPress')
        await Promise.resolve()
        expect(saved.length).toBe(3)

        invoke(button('tab-registry'), 'onPress')
        config = renderPane()
        const rawInput = input('registry-json')
        invoke(rawInput, 'onInput', JSON.stringify(registry.toData()))
        invoke(rawInput, 'onSubmit')
        await Promise.resolve()
        expect(saved.length).toBe(4)

        invoke(rawInput, 'onInput', '{')
        invoke(button('save-raw'), 'onPress')
        await Promise.resolve()
        expect(textOf(renderPane())).toContain('Configuration error')

        invoke(button('back-config'), 'onPress')
        config = renderPane()
        expect(textOf(config)).toContain('Policy registry editor')
        invoke(button('close-settings'), 'onPress')
        expect(closed).toContain('context-pilot-settings')
    })

    it('runs dashboard actions through the controller', async () => {
        const { view, controller, registry, runtime, configuration, render } =
            setup()
        controller.snapshot.context = {
            tokens: 350_000,
            window: 1_000_000,
        }
        controller.snapshot.resolvedPolicy = registry
            .active()
            .resolve(1_000_000)
        const ui = makeUi() as unknown as CommonUi
        const rendered = view.renderPane(
            ui,
            ui as unknown as ConfigUi,
            runtime,
            configuration,
            render
        )
        const button = (key: string) =>
            required(
                findAll(rendered, 'Button').find(
                    (item) => item.props.key === key
                ),
                key
            )

        invoke(button('evaluate-now'), 'onPress')
        await Promise.resolve()
        invoke(button('compact-now'), 'onPress')
        await Promise.resolve()
        await Promise.resolve()
        expect(controller.snapshot.lastDecision).toBeDefined()
    })

    it('falls back to read-only guidance without Input and Select', () => {
        const { view, navigation } = setup()
        void view.openConfig(navigation)
        const ui = makeUi(false) as unknown as CommonUi
        const rendered = view.renderPane(
            ui,
            undefined,
            {} as RuntimePort,
            {} as ConfigurationPort,
            { invalidate: async () => {} },
            { columns: 88, rows: 26 },
            'settings',
            navigation
        )
        expect(textOf(rendered)).toContain('does not provide Input/Select')
        expect(
            findAll(rendered, 'Button').map((item) => item.props.key)
        ).toEqual(['back-dashboard'])
    })

    it('renders the configuration help tab', () => {
        const { view, navigation, configuration, render } = setup()
        void view.openHelp(navigation)
        const ui = makeUi() as unknown as CommonUi
        const configUi = ui as unknown as ConfigUi
        const rendered = view.renderPane(
            ui,
            configUi,
            {} as RuntimePort,
            configuration,
            render,
            { columns: 88, rows: 26 },
            'settings',
            navigation
        )

        expect(textOf(rendered)).toContain('Field meanings')
        expect(textOf(rendered)).toContain('Registry shape')
        expect(textOf(rendered)).toContain('schemaVersion')
        expect(textOf(rendered)).toContain('Must be 2')
        expect(
            findAll(rendered, 'Code').map((item) => item.props.language)
        ).toEqual(['json'])
        expect(textOf(rendered)).toContain('thresholds.hostHeadroom')
        expect(textOf(rendered)).toContain('probe.maxProbesPerCycle')
        expect(textOf(rendered)).toContain('compaction.injectNative')
        expect(textOf(rendered)).not.toContain('nativeFailsafe')
        expect(textOf(rendered)).not.toContain('forkFailureAction')
        expect(
            findAll(rendered, 'Button').map((item) => item.props.key)
        ).toContain('tab-help')
    })

    it('renders the advanced registry editor and can return to config', () => {
        const { view, configuration, render, navigation } = setup()
        const ui = makeUi() as unknown as CommonUi
        const configUi = ui as unknown as ConfigUi
        void view.openConfig(navigation)

        const config = view.renderPane(
            ui,
            configUi,
            {} as RuntimePort,
            configuration,
            render,
            { columns: 88, rows: 26 },
            'settings',
            navigation
        )
        const raw = findAll(config, 'Button').find(
            (item) => item.props.key === 'tab-registry'
        )
        invoke(raw, 'onPress')

        const registry = view.renderPane(
            ui,
            configUi,
            {} as RuntimePort,
            configuration,
            render,
            { columns: 88, rows: 26 },
            'settings',
            navigation
        )
        expect(textOf(registry)).toContain('Advanced registry JSON')
        expect(textOf(registry)).toContain('✓ valid  1 policy · active test')
        const json = required(
            findAll(registry, 'Input').find(
                (item) => item.props.key === 'registry-json'
            ),
            'registry-json'
        )
        expect(String(json.props.value)).toContain('\n  "schemaVersion": 2')
        invoke(json, 'onInput', '{"schemaVersion": 1}')
        expect(
            textOf(
                view.renderPane(
                    ui,
                    configUi,
                    {} as RuntimePort,
                    configuration,
                    render,
                    { columns: 88, rows: 26 },
                    'settings',
                    navigation
                )
            )
        ).toContain('✖ invalid')
        expect(
            findAll(registry, 'Input').map((item) => item.props.key)
        ).toContain('registry-json')

        const back = findAll(registry, 'Button').find(
            (item) => item.props.key === 'back-config'
        )
        invoke(back, 'onPress')
        expect(
            textOf(
                view.renderPane(
                    ui,
                    configUi,
                    {} as RuntimePort,
                    configuration,
                    render,
                    { columns: 88, rows: 26 },
                    'settings',
                    navigation
                )
            )
        ).toContain('Policy registry editor')
    })
})
