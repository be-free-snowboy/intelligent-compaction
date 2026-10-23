import {
    PolicyDefinition,
    PolicyRegistry,
    type ThresholdUnit,
} from '../domain/policy'

export interface PolicyDraft {
    id: string
    label: string
    armValue: string
    armUnit: ThresholdUnit
    mandatoryValue: string
    mandatoryUnit: ThresholdUnit
    hostHeadroomValue: string
    hostHeadroomUnit: ThresholdUnit
    minGapValue: string
    minGapUnit: ThresholdUnit
    maxGapValue: string
    maxGapUnit: ThresholdUnit
    maxProbesPerCycle: string
    cacheFloor: string
    minProgressValue: string
    minProgressUnit: ThresholdUnit
    directiveMaxChars: string
    forkOnMandatory: boolean
    injectNative: boolean
    baseInstructions: string
}

export type PolicyTextField =
    | 'id'
    | 'label'
    | 'armValue'
    | 'mandatoryValue'
    | 'hostHeadroomValue'
    | 'minGapValue'
    | 'maxGapValue'
    | 'maxProbesPerCycle'
    | 'cacheFloor'
    | 'minProgressValue'
    | 'directiveMaxChars'
    | 'baseInstructions'
export type PolicyUnitField =
    | 'armUnit'
    | 'mandatoryUnit'
    | 'hostHeadroomUnit'
    | 'minGapUnit'
    | 'maxGapUnit'
    | 'minProgressUnit'
export type PaneMode = 'dashboard' | 'config' | 'registry' | 'help'

export class PolicyEditorState {
    mode: PaneMode = 'dashboard'
    selectedPolicyId: string
    draft: PolicyDraft
    cloneId = ''
    rawRegistryJson = ''
    error?: string | undefined
    /** What the last save did; cleared by the next edit. */
    notice?: string | undefined

    constructor(registry: PolicyRegistry, rawRegistryJson: string) {
        this.selectedPolicyId = registry.activePolicyId
        this.draft = this.fromPolicy(registry.active())
        this.rawRegistryJson = rawRegistryJson
    }

    select(registry: PolicyRegistry, id: string): void {
        const policy = registry.get(id)
        if (!policy) throw new Error(`Unknown policy: ${id}`)
        this.selectedPolicyId = id
        this.draft = this.fromPolicy(policy)
        this.error = undefined
        this.notice = undefined
    }

    updateText(field: PolicyTextField, value: string): void {
        this.draft[field] = value
        this.notice = undefined
    }

    updateUnit(field: PolicyUnitField, value: string): void {
        if (value !== 'tokens' && value !== 'ratio')
            throw new Error(`Unsupported threshold unit: ${value}`)
        this.draft[field] = value
        this.notice = undefined
    }

    toggleForkOnMandatory(): void {
        this.draft.forkOnMandatory = !this.draft.forkOnMandatory
        this.notice = undefined
    }

    toggleInjectNative(): void {
        this.draft.injectNative = !this.draft.injectNative
        this.notice = undefined
    }

    toDefinition(): PolicyDefinition {
        const d = this.draft
        return new PolicyDefinition({
            id: d.id.trim(),
            label: d.label.trim(),
            thresholds: {
                arm: { unit: d.armUnit, value: this.number(d.armValue, 'arm') },
                mandatory: {
                    unit: d.mandatoryUnit,
                    value: this.number(d.mandatoryValue, 'mandatory'),
                },
                hostHeadroom: {
                    unit: d.hostHeadroomUnit,
                    value: this.number(d.hostHeadroomValue, 'host headroom'),
                },
            },
            probe: {
                minGap: {
                    unit: d.minGapUnit,
                    value: this.number(d.minGapValue, 'minimum probe gap'),
                },
                maxGap: {
                    unit: d.maxGapUnit,
                    value: this.number(d.maxGapValue, 'maximum probe gap'),
                },
                maxProbesPerCycle: this.integer(
                    d.maxProbesPerCycle,
                    'max probes per cycle'
                ),
                cacheFloor: this.nonNegative(d.cacheFloor, 'cache floor'),
            },
            compaction: {
                minProgress: {
                    unit: d.minProgressUnit,
                    value: this.number(d.minProgressValue, 'minimum progress'),
                },
                directiveMaxChars: this.integer(
                    d.directiveMaxChars,
                    'directive max chars'
                ),
                forkOnMandatory: d.forkOnMandatory,
                injectNative: d.injectNative,
                baseInstructions: d.baseInstructions,
            },
        })
    }

    private fromPolicy(policy: PolicyDefinition): PolicyDraft {
        const data = policy.toData()
        return {
            id: data.id,
            label: data.label,
            armValue: String(data.thresholds.arm.value),
            armUnit: data.thresholds.arm.unit,
            mandatoryValue: String(data.thresholds.mandatory.value),
            mandatoryUnit: data.thresholds.mandatory.unit,
            hostHeadroomValue: String(data.thresholds.hostHeadroom.value),
            hostHeadroomUnit: data.thresholds.hostHeadroom.unit,
            minGapValue: String(data.probe.minGap.value),
            minGapUnit: data.probe.minGap.unit,
            maxGapValue: String(data.probe.maxGap.value),
            maxGapUnit: data.probe.maxGap.unit,
            maxProbesPerCycle: String(data.probe.maxProbesPerCycle),
            cacheFloor: String(data.probe.cacheFloor),
            minProgressValue: String(data.compaction.minProgress.value),
            minProgressUnit: data.compaction.minProgress.unit,
            directiveMaxChars: String(data.compaction.directiveMaxChars),
            forkOnMandatory: data.compaction.forkOnMandatory,
            injectNative: data.compaction.injectNative,
            baseInstructions: data.compaction.baseInstructions,
        }
    }

    private number(value: string, name: string): number {
        const parsed = Number(value)
        if (!Number.isFinite(parsed) || parsed <= 0)
            throw new Error(`${name} must be a positive number`)
        return parsed
    }

    private nonNegative(value: string, name: string): number {
        const parsed = value.trim() === '' ? Number.NaN : Number(value)
        if (!Number.isFinite(parsed) || parsed < 0)
            throw new Error(`${name} must be a non-negative number`)
        return parsed
    }

    private integer(value: string, name: string): number {
        const parsed = this.nonNegative(value, name)
        if (!Number.isInteger(parsed))
            throw new Error(`${name} must be an integer`)
        return parsed
    }
}
