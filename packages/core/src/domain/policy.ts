export type ThresholdUnit = 'tokens' | 'ratio'

export interface ThresholdSpec {
    readonly unit: ThresholdUnit
    readonly value: number
}

export interface PolicyThresholds {
    readonly arm: ThresholdSpec
    readonly mandatory: ThresholdSpec
    readonly hostHeadroom: ThresholdSpec
}

export interface ProbePolicy {
    readonly minGap: ThresholdSpec
    readonly maxGap: ThresholdSpec
    readonly maxProbesPerCycle: number
    readonly cacheFloor: number
}

export interface CompactionPolicy {
    readonly minProgress: ThresholdSpec
    readonly directiveMaxChars: number
    readonly forkOnMandatory: boolean
    readonly injectNative: boolean
    readonly baseInstructions: string
}

export interface PolicyDefinitionData {
    readonly id: string
    readonly label: string
    readonly thresholds: PolicyThresholds
    readonly probe: ProbePolicy
    readonly compaction: CompactionPolicy
}

export const POLICY_SCHEMA_VERSION = 2

export interface PolicyRegistryData {
    readonly schemaVersion: number
    readonly activePolicyId: string
    readonly policies: readonly PolicyDefinitionData[]
}

export interface ResolvedPolicy {
    readonly id: string
    readonly label: string
    readonly arm: number
    readonly mandatory: number
    readonly hostHeadroom: number
    readonly minGap: number
    readonly maxGap: number
    readonly maxProbesPerCycle: number
    readonly cacheFloor: number
    readonly minProgress: number
    readonly directiveMaxChars: number
    readonly forkOnMandatory: boolean
    readonly injectNative: boolean
    readonly baseInstructions: string
}

export class Threshold {
    readonly unit: ThresholdUnit
    readonly value: number

    constructor(spec: ThresholdSpec) {
        this.unit = spec.unit
        this.value = spec.value
        if (!Number.isFinite(this.value) || this.value <= 0) {
            throw new Error(
                `Threshold must be a positive finite number: ${this.value}`
            )
        }
        if (this.unit !== 'tokens' && this.unit !== 'ratio') {
            throw new Error(`Unsupported threshold unit: ${String(this.unit)}`)
        }
        if (this.unit === 'ratio' && this.value > 1) {
            throw new Error(`Ratio threshold must be <= 1: ${this.value}`)
        }
    }

    resolve(windowTokens: number): number {
        if (!Number.isFinite(windowTokens) || windowTokens <= 0) {
            throw new Error(`Context window must be positive: ${windowTokens}`)
        }
        const resolved =
            this.unit === 'tokens'
                ? Math.round(this.value)
                : Math.round(windowTokens * this.value)
        if (resolved <= 0)
            throw new Error(
                `Threshold resolves below one token: ${this.value} ${this.unit}`
            )
        return resolved
    }

    toData(): ThresholdSpec {
        return { unit: this.unit, value: this.value }
    }
}

export class PolicyDefinition {
    readonly id: string
    readonly label: string
    readonly thresholds: PolicyThresholds
    readonly probe: ProbePolicy
    readonly compaction: CompactionPolicy

    constructor(data: PolicyDefinitionData) {
        this.id = data.id.trim()
        this.label = data.label.trim()
        this.thresholds = Object.freeze({
            arm: Object.freeze(new Threshold(data.thresholds.arm).toData()),
            mandatory: Object.freeze(
                new Threshold(data.thresholds.mandatory).toData()
            ),
            hostHeadroom: Object.freeze(
                new Threshold(data.thresholds.hostHeadroom).toData()
            ),
        })
        this.probe = Object.freeze({
            minGap: Object.freeze(new Threshold(data.probe.minGap).toData()),
            maxGap: Object.freeze(new Threshold(data.probe.maxGap).toData()),
            maxProbesPerCycle: data.probe.maxProbesPerCycle,
            cacheFloor: data.probe.cacheFloor,
        })
        this.compaction = Object.freeze({
            minProgress: Object.freeze(
                new Threshold(data.compaction.minProgress).toData()
            ),
            directiveMaxChars: data.compaction.directiveMaxChars,
            forkOnMandatory: data.compaction.forkOnMandatory,
            injectNative: data.compaction.injectNative,
            baseInstructions: data.compaction.baseInstructions,
        })

        if (!this.id) throw new Error('Policy id is required')
        if (!this.label) throw new Error(`Policy ${this.id} requires a label`)
        const { maxProbesPerCycle, cacheFloor } = this.probe
        if (
            !Number.isInteger(maxProbesPerCycle) ||
            maxProbesPerCycle < 0 ||
            maxProbesPerCycle > 100
        ) {
            throw new Error(
                `Policy ${this.id}: maxProbesPerCycle must be an integer from 0 to 100`
            )
        }
        if (!Number.isFinite(cacheFloor) || cacheFloor < 0 || cacheFloor > 1) {
            throw new Error(
                `Policy ${this.id}: cacheFloor must be a number from 0 to 1`
            )
        }
        const { directiveMaxChars } = this.compaction
        if (
            !Number.isInteger(directiveMaxChars) ||
            directiveMaxChars < 1 ||
            directiveMaxChars > 8000
        ) {
            throw new Error(
                `Policy ${this.id}: directiveMaxChars must be an integer from 1 to 8000`
            )
        }
        if (!this.compaction.baseInstructions.trim()) {
            throw new Error(`Policy ${this.id}: baseInstructions is required`)
        }

        // Threshold values were normalized through value objects above. Ordering is
        // validated against the actual model context window when the policy resolves.
    }

    resolve(windowTokens: number): ResolvedPolicy {
        const arm = new Threshold(this.thresholds.arm).resolve(windowTokens)
        const mandatory = new Threshold(this.thresholds.mandatory).resolve(
            windowTokens
        )
        const hostHeadroom = new Threshold(
            this.thresholds.hostHeadroom
        ).resolve(windowTokens)
        const minGap = new Threshold(this.probe.minGap).resolve(windowTokens)
        const maxGap = new Threshold(this.probe.maxGap).resolve(windowTokens)
        const minProgress = new Threshold(this.compaction.minProgress).resolve(
            windowTokens
        )

        if (arm >= mandatory) {
            throw new Error(
                `Policy ${this.id}: arm must resolve below mandatory (${arm} >= ${mandatory})`
            )
        }
        if (mandatory > windowTokens) {
            throw new Error(
                `Policy ${this.id}: mandatory must resolve within the context window (${mandatory} > ${windowTokens})`
            )
        }
        if (minGap > maxGap) {
            throw new Error(
                `Policy ${this.id}: minGap must resolve <= maxGap (${minGap} > ${maxGap})`
            )
        }
        if (minProgress >= mandatory) {
            throw new Error(
                `Policy ${this.id}: minProgress must resolve below mandatory (${minProgress} >= ${mandatory})`
            )
        }

        return {
            id: this.id,
            label: this.label,
            arm,
            mandatory,
            hostHeadroom,
            minGap,
            maxGap,
            maxProbesPerCycle: this.probe.maxProbesPerCycle,
            cacheFloor: this.probe.cacheFloor,
            minProgress,
            directiveMaxChars: this.compaction.directiveMaxChars,
            forkOnMandatory: this.compaction.forkOnMandatory,
            injectNative: this.compaction.injectNative,
            baseInstructions: this.compaction.baseInstructions.trim(),
        }
    }

    toData(): PolicyDefinitionData {
        return {
            id: this.id,
            label: this.label,
            thresholds: this.thresholds,
            probe: this.probe,
            compaction: this.compaction,
        }
    }
}

export class PolicyRegistry {
    readonly schemaVersion: number
    private readonly definitions: ReadonlyMap<string, PolicyDefinition>
    readonly activePolicyId: string

    constructor(data: PolicyRegistryData) {
        if (data.schemaVersion !== POLICY_SCHEMA_VERSION) {
            throw new Error(
                `Policy registry schemaVersion must be ${POLICY_SCHEMA_VERSION} (got ${String(data.schemaVersion)}); version 1 registries must be re-saved as schemaVersion ${POLICY_SCHEMA_VERSION}`
            )
        }
        if (!Array.isArray(data.policies) || data.policies.length === 0) {
            throw new Error('Policy registry must contain at least one policy')
        }

        const entries = data.policies.map((raw) => {
            const definition = new PolicyDefinition(raw)
            return [definition.id, definition] as const
        })
        const map = new Map(entries)
        if (map.size !== entries.length)
            throw new Error('Policy ids must be unique')
        if (!map.has(data.activePolicyId)) {
            throw new Error(
                `Active policy does not exist: ${data.activePolicyId}`
            )
        }

        this.schemaVersion = data.schemaVersion
        this.definitions = map
        this.activePolicyId = data.activePolicyId
    }

    active(): PolicyDefinition {
        const value = this.definitions.get(this.activePolicyId)
        if (!value)
            throw new Error(`Active policy disappeared: ${this.activePolicyId}`)
        return value
    }

    get(id: string): PolicyDefinition | undefined {
        return this.definitions.get(id)
    }

    list(): readonly PolicyDefinition[] {
        return [...this.definitions.values()]
    }

    replace(definition: PolicyDefinition): PolicyRegistry {
        const policies = this.list().map((item) =>
            item.id === definition.id ? definition.toData() : item.toData()
        )
        if (!this.definitions.has(definition.id))
            policies.push(definition.toData())
        return new PolicyRegistry({
            schemaVersion: this.schemaVersion,
            activePolicyId: this.activePolicyId,
            policies,
        })
    }

    activate(id: string): PolicyRegistry {
        if (!this.definitions.has(id))
            throw new Error(`Cannot activate unknown policy: ${id}`)
        return new PolicyRegistry({
            schemaVersion: this.schemaVersion,
            activePolicyId: id,
            policies: this.list().map((policy) => policy.toData()),
        })
    }

    clone(sourceId: string, newId: string): PolicyRegistry {
        const source = this.get(sourceId)
        if (!source) throw new Error(`Cannot clone unknown policy: ${sourceId}`)
        const id = newId.trim()
        if (!id) throw new Error('New policy id is required')
        if (this.definitions.has(id))
            throw new Error(`Policy id already exists: ${id}`)
        const copy = new PolicyDefinition({ ...source.toData(), id, label: id })
        const policies = [...this.list().map((p) => p.toData()), copy.toData()]
        return new PolicyRegistry({
            schemaVersion: this.schemaVersion,
            activePolicyId: id,
            policies,
        })
    }

    toData(): PolicyRegistryData {
        return {
            schemaVersion: this.schemaVersion,
            activePolicyId: this.activePolicyId,
            policies: this.list().map((policy) => policy.toData()),
        }
    }
}
