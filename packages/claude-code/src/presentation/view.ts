import {
    ContextPilotController,
    PolicyEditorState,
    PolicyRegistry,
    PolicyRegistryCodec,
    type ConfigurationPort,
    type PaneMode,
    type RuntimePort,
} from '@intelligent-compact/core'
import { PANE_ID, SETTINGS_PANE_ID } from '../plugin-identity'
import { renderBand } from './band'
import { renderDashboard } from './dashboard'
import {
    renderConfig,
    renderHelp,
    renderRegistry,
    renderUnsupported,
    type SettingsContext,
} from './settings'
import type {
    CommonUi,
    ConfigUi,
    PaneLayout,
    ViewElement,
    ViewNavigationPort,
    ViewRenderPort,
} from './ui-port'

export interface ViewSettings {
    readonly showStatusBand: boolean
}

export type PaneKind = 'dashboard' | 'settings'

/** The editor's place, carried across a reload of the plugin. */
export interface ViewCarry {
    readonly mode: PaneMode
    readonly selectedPolicyId: string
    readonly notice?: string | undefined
}

const PANE_MODES: ReadonlySet<string> = new Set<PaneMode>([
    'dashboard',
    'config',
    'registry',
    'help',
])

const DEFAULT_LAYOUT: PaneLayout = { columns: 88, rows: 26 }

/** Owns the presentation state (band visibility, policy editor) and routes each pane. */
export class ContextPilotView {
    private readonly registry: PolicyRegistry
    private readonly controller: ContextPilotController
    private readonly codec: PolicyRegistryCodec
    private readonly editor: PolicyEditorState
    private settings: ViewSettings

    constructor(
        controller: ContextPilotController,
        registry: PolicyRegistry,
        codec: PolicyRegistryCodec,
        rawRegistryJson: string,
        settings: ViewSettings
    ) {
        this.controller = controller
        this.registry = registry
        this.codec = codec
        this.editor = new PolicyEditorState(registry, rawRegistryJson)
        this.settings = settings
    }

    carry(): ViewCarry {
        return {
            mode: this.editor.mode,
            selectedPolicyId: this.editor.selectedPolicyId,
            notice: this.editor.notice,
        }
    }

    /** Takes up a carried place; a part that no longer fits is left out. */
    restore(raw: unknown): void {
        if (typeof raw !== 'object' || raw === null) return
        const carry = raw as Partial<Record<keyof ViewCarry, unknown>>
        if (typeof carry.mode === 'string' && PANE_MODES.has(carry.mode))
            this.editor.mode = carry.mode as PaneMode
        if (
            typeof carry.selectedPolicyId === 'string' &&
            this.registry.get(carry.selectedPolicyId)
        )
            this.editor.select(this.registry, carry.selectedPolicyId)
        if (typeof carry.notice === 'string') this.editor.notice = carry.notice
    }

    setStatusBandVisible(value: boolean): void {
        this.settings = { showStatusBand: value }
    }

    async openDashboard(navigation: ViewNavigationPort): Promise<void> {
        this.editor.mode = 'dashboard'
        await navigation.open({
            id: PANE_ID,
            title: 'context-pilot',
            focus: true,
            closeOnEscape: true,
            rows: 44,
            columns: 84,
        })
        await navigation.invalidate()
    }

    async openConfig(navigation: ViewNavigationPort): Promise<void> {
        await this.openSettings(navigation, 'config')
    }

    async openHelp(navigation: ViewNavigationPort): Promise<void> {
        await this.openSettings(navigation, 'help')
    }

    private async openSettings(
        navigation: ViewNavigationPort,
        mode: 'config' | 'help'
    ): Promise<void> {
        this.editor.mode = mode
        await navigation.open({
            id: SETTINGS_PANE_ID,
            title: 'context-pilot · settings',
            focus: true,
            closeOnEscape: true,
            rows: 44,
            columns: 96,
        })
        await navigation.invalidate()
    }

    renderAbovePrompt(
        ui: CommonUi,
        downstream: ViewElement,
        maxColumns = 100
    ): ViewElement {
        if (!this.settings.showStatusBand) return downstream
        return renderBand(ui, this.controller, downstream, maxColumns)
    }

    renderPane(
        ui: CommonUi,
        configUi: ConfigUi | undefined,
        runtime: RuntimePort,
        configuration: ConfigurationPort,
        render: ViewRenderPort,
        layout: PaneLayout = DEFAULT_LAYOUT,
        pane: PaneKind = 'dashboard',
        navigation?: ViewNavigationPort
    ): ViewElement {
        if (pane === 'settings') {
            const ctx: SettingsContext = {
                registry: this.registry,
                codec: this.codec,
                editor: this.editor,
                configuration,
                render,
                layout,
                navigation,
            }
            if (!configUi) return renderUnsupported(ui, ctx)
            if (this.editor.mode === 'help') return renderHelp(configUi, ctx)
            if (this.editor.mode === 'registry')
                return renderRegistry(configUi, ctx)
            return renderConfig(configUi, ctx)
        }
        return renderDashboard({
            ui,
            controller: this.controller,
            runtime,
            configuration,
            render,
            layout,
            showStatusBand: this.settings.showStatusBand,
            setStatusBand: (visible) => this.setStatusBandVisible(visible),
            reportError: (error) => {
                this.editor.error = String(error)
                void render.invalidate()
            },
            openPolicy: () => {
                if (navigation) {
                    void this.openConfig(navigation)
                    return
                }
                this.editor.mode = 'config'
                void render.invalidate()
            },
            openHelp: () => {
                if (navigation) {
                    void this.openHelp(navigation)
                    return
                }
                this.editor.mode = 'help'
                void render.invalidate()
            },
        })
    }
}
