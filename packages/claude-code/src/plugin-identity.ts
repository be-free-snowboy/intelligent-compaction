export const PLUGIN_ID = 'context-pilot' as const
export const PANE_ID = PLUGIN_ID
export const SETTINGS_PANE_ID = `${PLUGIN_ID}-settings` as const
export const COMMAND_NAME = PLUGIN_ID

export const CONFIG_KEYS = Object.freeze({
    registry: `${PLUGIN_ID}.policy_registry_json`,
    autoEnabled: `${PLUGIN_ID}.auto_enabled`,
    showStatusBand: `${PLUGIN_ID}.show_status_band`,
})
