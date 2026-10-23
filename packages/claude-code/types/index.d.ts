// The context-pilot `$.state` contract: the session carried across a reload of
// the plugin (a settings change reloads it). Both parts are JSON the plugin
// validates as it reads them back, so a stale shape starts the session fresh.
export interface ContextPilotSessionCarry {
    readonly controller: unknown
    readonly view: unknown
}

declare module 'claude-code' {
    interface PluginState {
        'context-pilot': { session: ContextPilotSessionCarry }
    }
}
