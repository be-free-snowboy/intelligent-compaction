import type { PluginOptions } from 'claude-code'
import { PolicyRegistry, PolicyRegistryCodec } from '@intelligent-compact/core'

export interface ContextPilotOptions {
    readonly autoEnabled: boolean
    readonly showStatusBand: boolean
    readonly registry: PolicyRegistry
}

export class PluginOptionsAdapter {
    private readonly codec: PolicyRegistryCodec

    constructor(codec: PolicyRegistryCodec) {
        this.codec = codec
    }

    adapt(options: PluginOptions): ContextPilotOptions {
        const registryJson = options.policy_registry_json
        if (typeof registryJson !== 'string' || registryJson.trim() === '') {
            throw new Error('policy_registry_json must be configured')
        }
        return {
            autoEnabled: options.auto_enabled !== false,
            showStatusBand: options.show_status_band !== false,
            registry: this.codec.parse(registryJson),
        }
    }
}
