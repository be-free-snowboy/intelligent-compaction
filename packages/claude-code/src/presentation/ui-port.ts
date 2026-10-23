import type { ElementTable, RenderElement } from 'claude-code'

/** Common element subset available on every Claude Code rendering surface. */
export type CommonUi = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button'>

/** Configuration controls are unavailable on mobile, so they are injected separately. */
export type ConfigUi = Pick<
    ElementTable<'terminal'>,
    'Box' | 'Text' | 'Button' | 'Input' | 'Select' | 'Code'
>

export interface PaneOpenRequest {
    readonly id: string
    readonly title: string
    readonly focus: true
    readonly closeOnEscape: true
    readonly rows: number
    readonly columns: number
}

export interface PaneLayout {
    readonly columns: number
    readonly rows: number
    readonly placement?: 'dock' | 'inline' | undefined
    readonly surface?: string | undefined
}

export interface ViewNavigationPort {
    open(request: PaneOpenRequest): Promise<void>
    close(request: { readonly id: string }): Promise<void>
    invalidate(): Promise<void>
}

export interface ViewRenderPort {
    invalidate(): Promise<void>
}

export type ViewElement = RenderElement
