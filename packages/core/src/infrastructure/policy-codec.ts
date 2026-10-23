import {
    PolicyRegistry,
    type CompactionPolicy,
    type PolicyDefinitionData,
    type PolicyRegistryData,
    type PolicyThresholds,
    type ProbePolicy,
    type ThresholdSpec,
    type ThresholdUnit,
} from '../domain/policy'

/**
 * Boundary codec for the user-editable registry JSON.
 * Unknown JSON never crosses into the domain layer without structural decoding.
 */
export class PolicyRegistryCodec {
    parse(json: string): PolicyRegistry {
        let raw: unknown
        try {
            raw = JSON.parse(json)
        } catch (error) {
            throw new Error(
                `Policy registry JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error }
            )
        }
        return new PolicyRegistry(this.decodeRegistry(raw, '$'))
    }

    stringify(registry: PolicyRegistry): string {
        return JSON.stringify(registry.toData())
    }

    pretty(registry: PolicyRegistry): string {
        return JSON.stringify(registry.toData(), null, 2)
    }

    private decodeRegistry(value: unknown, path: string): PolicyRegistryData {
        const object = this.record(value, path)
        return {
            schemaVersion: this.integer(
                object.schemaVersion,
                `${path}.schemaVersion`
            ),
            activePolicyId: this.string(
                object.activePolicyId,
                `${path}.activePolicyId`
            ),
            policies: this.array(object.policies, `${path}.policies`).map(
                (policy, index) =>
                    this.decodePolicy(policy, `${path}.policies[${index}]`)
            ),
        }
    }

    private decodePolicy(value: unknown, path: string): PolicyDefinitionData {
        const object = this.record(value, path)
        return {
            id: this.string(object.id, `${path}.id`),
            label: this.string(object.label, `${path}.label`),
            thresholds: this.decodeThresholds(
                object.thresholds,
                `${path}.thresholds`
            ),
            probe: this.decodeProbe(object.probe, `${path}.probe`),
            compaction: this.decodeCompaction(
                object.compaction,
                `${path}.compaction`
            ),
        }
    }

    private decodeThresholds(value: unknown, path: string): PolicyThresholds {
        const object = this.record(value, path)
        return {
            arm: this.decodeThreshold(object.arm, `${path}.arm`),
            mandatory: this.decodeThreshold(
                object.mandatory,
                `${path}.mandatory`
            ),
            hostHeadroom: this.decodeThreshold(
                object.hostHeadroom,
                `${path}.hostHeadroom`
            ),
        }
    }

    private decodeProbe(value: unknown, path: string): ProbePolicy {
        const object = this.record(value, path)
        return {
            minGap: this.decodeThreshold(object.minGap, `${path}.minGap`),
            maxGap: this.decodeThreshold(object.maxGap, `${path}.maxGap`),
            maxProbesPerCycle: this.integer(
                object.maxProbesPerCycle,
                `${path}.maxProbesPerCycle`
            ),
            cacheFloor: this.number(object.cacheFloor, `${path}.cacheFloor`),
        }
    }

    private decodeCompaction(value: unknown, path: string): CompactionPolicy {
        const object = this.record(value, path)
        return {
            minProgress: this.decodeThreshold(
                object.minProgress,
                `${path}.minProgress`
            ),
            directiveMaxChars: this.integer(
                object.directiveMaxChars,
                `${path}.directiveMaxChars`
            ),
            forkOnMandatory: this.boolean(
                object.forkOnMandatory,
                `${path}.forkOnMandatory`
            ),
            injectNative: this.boolean(
                object.injectNative,
                `${path}.injectNative`
            ),
            baseInstructions: this.string(
                object.baseInstructions,
                `${path}.baseInstructions`
            ),
        }
    }

    private decodeThreshold(value: unknown, path: string): ThresholdSpec {
        const object = this.record(value, path)
        return {
            unit: this.thresholdUnit(object.unit, `${path}.unit`),
            value: this.number(object.value, `${path}.value`),
        }
    }

    private thresholdUnit(value: unknown, path: string): ThresholdUnit {
        if (value !== 'tokens' && value !== 'ratio')
            throw new Error(`${path} must be "tokens" or "ratio"`)
        return value
    }

    private record(value: unknown, path: string): Record<string, unknown> {
        if (typeof value !== 'object' || value === null || Array.isArray(value))
            throw new Error(`${path} must be an object`)
        return value as Record<string, unknown>
    }

    private array(value: unknown, path: string): readonly unknown[] {
        if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
        return value
    }

    private string(value: unknown, path: string): string {
        if (typeof value !== 'string')
            throw new Error(`${path} must be a string`)
        return value
    }

    private boolean(value: unknown, path: string): boolean {
        if (typeof value !== 'boolean')
            throw new Error(`${path} must be a boolean`)
        return value
    }

    private number(value: unknown, path: string): number {
        if (typeof value !== 'number' || !Number.isFinite(value))
            throw new Error(`${path} must be a finite number`)
        return value
    }

    private integer(value: unknown, path: string): number {
        const number = this.number(value, path)
        if (!Number.isInteger(number))
            throw new Error(`${path} must be an integer`)
        return number
    }
}
