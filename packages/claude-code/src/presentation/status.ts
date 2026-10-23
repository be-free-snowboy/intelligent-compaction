import {
    formatTokens,
    type ContextPilotController,
} from '@intelligent-compact/core'

/** AUTO and MANUAL as configured; OBSERVE where the host cannot compact. */
export function automationLabel(controller: ContextPilotController): string {
    if (!controller.autoEnabled) return 'MANUAL'
    return controller.hostCanCompact ? 'AUTO' : 'OBSERVE'
}

/** The one-line answer of `/context-pilot status`. */
export function statusText(controller: ContextPilotController): string {
    const state = controller.snapshot
    const policy = state.resolvedPolicy
    const parts = [
        'status',
        policy?.id ?? 'unresolved',
        `${formatTokens(state.context.tokens)}/${state.context.window > 0 ? formatTokens(state.context.window) : '—'}`,
        `next ${formatTokens(state.nextProbeAt)}`,
        `probes ${state.cycle.probes}/${policy?.maxProbesPerCycle ?? '—'}`,
        automationLabel(controller),
        state.lastDecision,
    ]
    if (state.lastError) parts.push(`error: ${state.lastError}`)
    for (const warning of state.warnings) parts.push(`warning: ${warning}`)
    return parts.join(' · ')
}
