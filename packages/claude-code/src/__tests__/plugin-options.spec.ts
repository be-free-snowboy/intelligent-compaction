import { describe, expect, it } from 'vitest'
import type { PluginOptions } from 'claude-code'
import { PolicyRegistry, PolicyRegistryCodec } from '@intelligent-compact/core'
import { PluginOptionsAdapter } from '../plugin-options'

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

function registryJson(): string {
    return new PolicyRegistryCodec().stringify(
        new PolicyRegistry({
            schemaVersion: 2,
            activePolicyId: 'test',
            policies: [policyData],
        })
    )
}

function options(overrides: Record<string, unknown> = {}): PluginOptions {
    return {
        auto_enabled: true,
        show_status_band: true,
        policy_registry_json: registryJson(),
        ...overrides,
    } as PluginOptions
}

describe('PluginOptionsAdapter', () => {
    it('decodes booleans and the injected registry', () => {
        const adapted = new PluginOptionsAdapter(
            new PolicyRegistryCodec()
        ).adapt(options())
        expect(adapted.autoEnabled).toBe(true)
        expect(adapted.showStatusBand).toBe(true)
        expect(adapted.registry.active().id).toBe('test')
    })

    it('treats only explicit false as disabled', () => {
        const adapted = new PluginOptionsAdapter(
            new PolicyRegistryCodec()
        ).adapt(options({ auto_enabled: false, show_status_band: false }))
        expect(adapted.autoEnabled).toBe(false)
        expect(adapted.showStatusBand).toBe(false)
    })

    it('defaults missing optional booleans to enabled', () => {
        const adapted = new PluginOptionsAdapter(
            new PolicyRegistryCodec()
        ).adapt(
            options({ auto_enabled: undefined, show_status_band: undefined })
        )
        expect(adapted.autoEnabled).toBe(true)
        expect(adapted.showStatusBand).toBe(true)
    })

    it('fails loudly when the registry is missing or empty', () => {
        const adapter = new PluginOptionsAdapter(new PolicyRegistryCodec())
        expect(() =>
            adapter.adapt(options({ policy_registry_json: undefined }))
        ).toThrow(/must be configured/)
        expect(() =>
            adapter.adapt(options({ policy_registry_json: '' }))
        ).toThrow(/must be configured/)
    })

    it('rejects malformed registry JSON', () => {
        const adapter = new PluginOptionsAdapter(new PolicyRegistryCodec())
        expect(() =>
            adapter.adapt(options({ policy_registry_json: '{' }))
        ).toThrow(/invalid/i)
        expect(() =>
            adapter.adapt(
                options({
                    policy_registry_json:
                        '{"schemaVersion":2,"activePolicyId":"test"}',
                })
            )
        ).toThrow(/\$\.policies/)
    })
})
