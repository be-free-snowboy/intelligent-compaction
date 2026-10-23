import type { EngineInterface, Register, RenderInput } from 'claude-code'
import type { ContextPilotSessionCarry } from '../types'
import {
    ContextPilotController,
    ContextPilotState,
    InstructionComposer,
    PolicyRegistryCodec,
    ProbeDecisionParser,
    ProbeScheduler,
    SemanticProbePromptFactory,
    type ConfigurationPort,
    type RuntimePort,
} from '@intelligent-compact/core'
import {
    COMMAND_NAME,
    CONFIG_KEYS,
    PANE_ID,
    SETTINGS_PANE_ID,
} from './plugin-identity'
import { toForkOutcome } from './host-mapping'
import { PluginOptionsAdapter } from './plugin-options'
import { statusText } from './presentation/status'
import type {
    PaneLayout,
    ViewNavigationPort,
    ViewRenderPort,
} from './presentation/ui-port'
import { ContextPilotView } from './presentation/view'

/**
 * Claude Code composition root.
 *
 * All host capabilities (`$`) are intentionally terminated in this file. Domain,
 * application and presentation layers communicate through ports or injected UI
 * element constructors, keeping policy logic deterministic and host-independent.
 */
export const register: Register = (on, options) => {
    const codec = new PolicyRegistryCodec()
    const adapted = new PluginOptionsAdapter(codec).adapt(options)
    const state = new ContextPilotState()
    const controller = new ContextPilotController(
        adapted.registry,
        state,
        {
            parser: new ProbeDecisionParser(),
            scheduler: new ProbeScheduler(),
            prompts: new SemanticProbePromptFactory(),
            composer: new InstructionComposer(),
        },
        // Headless until session.start says a person is at the prompt.
        { autoEnabled: adapted.autoEnabled, hostCanCompact: false }
    )
    const view = new ContextPilotView(
        controller,
        adapted.registry,
        codec,
        codec.stringify(adapted.registry),
        { showStatusBand: adapted.showStatusBand }
    )

    const carry: CarrySource = () => {
        const session = controller.carry()
        return session && { controller: session, view: view.carry() }
    }

    on('session.start', async ($, e, next) => {
        const result = await next(e)
        controller.setHostCanCompact(e.isInteractive)
        state.telemetry.load(await $.store.get(TELEMETRY_KEY))
        // A settings change reloads the plugin and runs this again in the
        // same session: the carry keeps its cycle, decisions and editor place.
        const { value: carried } = await $.state.get(SESSION_STATE)
        const runtime = createRuntimePort($, carry)
        if (await controller.initialize(runtime, carried?.controller)) {
            view.restore(carried?.view)
        }
        try {
            await $.command.register({
                name: COMMAND_NAME,
                description:
                    'Adaptive semantic compaction: open | config | help | evaluate | compact | status',
                argumentHint: '[open|config|help|evaluate|compact|status]',
            })
        } catch (error) {
            state.lastError =
                error instanceof Error ? error.message : String(error)
        }
        return result
    })

    on('session.end', async ($, e, next) => {
        const result = await next(e)
        // `/clear` fires no later session.start, so the reset cannot wait on storage.
        const telemetry = state.telemetry.toData()
        controller.resetSession()
        try {
            // An ended session is never taken up again by a later start.
            await $.state.set(SESSION_STATE, { controller: null, view: null })
        } catch {
            // Unset, the carry still names the ended session's id alone.
        }
        try {
            await $.store.set(TELEMETRY_KEY, telemetry)
        } catch (error) {
            state.lastError = `Telemetry not saved: ${error instanceof Error ? error.message : String(error)}`
        }
        await $.ui.invalidate('ui.render')
        return result
    })

    on('session.measure', async ($, e, next) => {
        const result = await next(e)
        const changed = controller.observeContext({
            tokens: e.context.tokens,
            window: e.context.window,
            percent: e.context.percent,
        })
        if (changed) await $.ui.invalidate('ui.render')
        return result
    })

    // The engine measures at turn ends only; each main-thread tool call
    // follows a response that moved the fill, so the views track it mid-turn.
    on('tool.call', async ($, e, next) => {
        if (e.agentId === undefined) await syncContext($, controller)
        return next(e)
    }).catch(($, e, next) => next(e))

    on('turn.complete', async ($, e, next) => {
        const result = await next(e)
        if (e.agentId === undefined && e.reason === 'answer') {
            await controller.onMainTurnComplete(createRuntimePort($, carry))
            await saveCarry($, carry)
        }
        return result
    })

    // Native compactions of the main thread get the policy instructions. The
    // plugin's own (`plugin`) are not matched: the controller composed theirs.
    on(
        'session.compact',
        { trigger: ['auto', 'manual', 'precompute'] },
        async ($, e, next) => {
            if (e.agentId !== undefined) return next(e)
            const instructions = controller.nativeInstructions(e.instructions)
            const result = await next(
                instructions === undefined ? e : { ...e, instructions }
            )
            if (e.trigger !== 'precompute' && result.skip === undefined) {
                controller.noteExternalCompaction(
                    e.trigger,
                    result.tokensBefore,
                    result.tokensAfter
                )
                await $.store.set(TELEMETRY_KEY, state.telemetry.toData())
                await saveCarry($, carry)
                await $.ui.invalidate('ui.render')
            }
            return result
        }
    ).catch(($, e, next) => next(e))

    on('command.run', { command: COMMAND_NAME }, async ($, e) => {
        const arg = String(e.args ?? '')
            .trim()
            .toLowerCase()
        const runtime = createRuntimePort($, carry)
        const navigation = createNavigationPort($)

        if (!arg || arg === 'open') {
            await view.openDashboard(navigation)
            return {}
        }
        if (arg === 'config') {
            await view.openConfig(navigation)
            return {}
        }
        if (arg === 'help') {
            await view.openHelp(navigation)
            return {}
        }
        if (arg === 'evaluate' || arg === 'eval') {
            await controller.evaluateNow(runtime)
            return { text: `decision · ${state.lastDecision}` }
        }
        if (arg === 'compact') {
            await controller.compactNow(runtime)
            return { text: `decision · ${state.lastDecision}` }
        }
        if (arg === 'status') return { text: statusText(controller) }
        return {
            text: 'Usage: /context-pilot [open|config|help|evaluate|compact|status]',
        }
    }).catch((_$, _e, next) => ({
        text: `context-pilot: command failed (${next.error.kind})`,
    }))

    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
        const downstream = await next(e)
        const ui = $.ui.resolve(e)
        const columns =
            typeof e.props?.bodyColumns === 'number'
                ? e.props.bodyColumns
                : undefined
        return view.renderAbovePrompt(ui, downstream, columns)
    })

    on('ui.render', { component: 'Pane' }, async ($, e, next) => {
        const requestId = e.requestId
        if (requestId !== PANE_ID && requestId !== SETTINGS_PANE_ID) {
            return next(e)
        }

        const runtime = createRuntimePort($, carry)
        const configuration = createConfigurationPort($, carry)
        const render = createRenderPort($)
        const navigation = createNavigationPort($)
        const layout = paneLayout(e)
        const pane = requestId === SETTINGS_PANE_ID ? 'settings' : 'dashboard'

        const ui = $.ui.resolve(e)
        if ('Input' in ui && 'Select' in ui) {
            return view.renderPane(
                ui,
                ui,
                runtime,
                configuration,
                render,
                layout,
                pane,
                navigation
            )
        }
        return view.renderPane(
            ui,
            undefined,
            runtime,
            configuration,
            render,
            layout,
            pane,
            navigation
        )
    })
}

/** `$.store` key of the lifetime telemetry (docs/ARCHITECTURE.md §6). */
const TELEMETRY_KEY = 'telemetry'

/** `$.state` value carried across reloads; declared in types/index.d.ts. */
const SESSION_STATE = { plugin: 'context-pilot', key: 'session' } as const

type CarrySource = () => ContextPilotSessionCarry | undefined

/** Keeps the session's state where a reload of the plugin finds it. */
async function saveCarry(
    $: EngineInterface,
    carry: CarrySource
): Promise<void> {
    const value = carry()
    if (!value) return
    try {
        await $.state.set(SESSION_STATE, value)
    } catch {
        // Refused while drawing or once unloaded: the last carry stands.
    }
}

/** Reads the fill the host has now; between turn ends no event pushes it. */
async function syncContext(
    $: EngineInterface,
    controller: ContextPilotController
): Promise<void> {
    const { context } = await $.session.usage()
    const changed = controller.observeContext({
        tokens: context.tokens,
        window: context.window,
        percent: context.percent,
    })
    if (changed) await $.ui.invalidate('ui.render')
}

function paneLayout(e: RenderInput<'Pane'>): PaneLayout {
    const props = e.props ?? {}
    const scroll =
        typeof props.scroll === 'object' && props.scroll !== null
            ? (props.scroll as { bodyRows?: unknown })
            : undefined
    const columns =
        typeof props.bodyColumns === 'number'
            ? props.bodyColumns
            : (e.viewport?.columns ?? 88)
    const rows =
        typeof scroll?.bodyRows === 'number'
            ? scroll.bodyRows
            : (e.viewport?.rows ?? 26)
    const placement =
        props.placement === 'dock' || props.placement === 'inline'
            ? props.placement
            : undefined
    return {
        columns,
        rows,
        placement,
        surface: e.surface,
    }
}

function createRuntimePort(
    $: EngineInterface,
    carry: CarrySource
): RuntimePort {
    return {
        async readContext() {
            const usage = await $.session.usage({ breakdown: 'summary' })
            const context = usage.context
            return {
                tokens: context.tokens,
                window: context.window,
                percent: context.percent,
                hostAutoCompactThreshold:
                    context.breakdown?.autoCompactThreshold,
                hostAutoCompactEnabled: context.breakdown?.isAutoCompactEnabled,
            }
        },
        async fork(prompt) {
            return toForkOutcome(await $.model.fork({ prompt }))
        },
        async compact(instructions) {
            const result = await $.session.compact(
                instructions ? { instructions } : undefined
            )
            if (result.skip !== undefined) return { skip: result.skip }
            return {
                tokensBefore: result.tokensBefore,
                tokensAfter: result.tokensAfter,
            }
        },
        async sessionId() {
            return $.session.id()
        },
        async toast(message) {
            await $.ui.toast(message)
        },
        async invalidateUi() {
            await saveCarry($, carry)
            await $.ui.invalidate('ui.render')
        },
        async saveTelemetry(data) {
            await $.store.set(TELEMETRY_KEY, data)
        },
    }
}

function createConfigurationPort(
    $: EngineInterface,
    carry: CarrySource
): ConfigurationPort {
    const set = async (key: string, value: string | boolean): Promise<void> => {
        // A changed option reloads the plugin as this call writes it.
        await saveCarry($, carry)
        const result = await $.config.set({ key, value })
        if ('deny' in result && result.deny) throw new Error(result.deny)
    }
    return {
        saveRegistryJson: (json) => set(CONFIG_KEYS.registry, json),
        setAutoEnabled: (enabled) => set(CONFIG_KEYS.autoEnabled, enabled),
        setShowStatusBand: (enabled) =>
            set(CONFIG_KEYS.showStatusBand, enabled),
    }
}

function createNavigationPort($: EngineInterface): ViewNavigationPort {
    return {
        async open(request) {
            await $.ui.open(request)
        },
        async close(request) {
            await $.ui.close(request)
        },
        async invalidate() {
            await $.ui.invalidate('ui.render')
        },
    }
}

function createRenderPort($: EngineInterface): ViewRenderPort {
    return {
        async invalidate() {
            await $.ui.invalidate('ui.render')
        },
    }
}
