import { describe, expect, it } from 'vitest'
import { PolicyRegistry, type PolicyDefinitionData } from '../domain/policy'
import {
    PolicyEditorState,
    type PolicyDraft,
} from '../presentation/editor-state'

const policyData: PolicyDefinitionData = {
    id: 'test',
    label: 'Test policy',
    thresholds: {
        arm: { unit: 'ratio', value: 0.3 },
        mandatory: { unit: 'ratio', value: 0.5 },
        hostHeadroom: { unit: 'ratio', value: 0.1 },
    },
    probe: {
        minGap: { unit: 'tokens', value: 5_000 },
        maxGap: { unit: 'tokens', value: 50_000 },
        maxProbesPerCycle: 5,
        cacheFloor: 0.7,
    },
    compaction: {
        minProgress: { unit: 'ratio', value: 0.15 },
        directiveMaxChars: 120,
        forkOnMandatory: true,
        injectNative: true,
        baseInstructions: 'Preserve task state.',
    },
}

function registry(): PolicyRegistry {
    return new PolicyRegistry({
        schemaVersion: 2,
        activePolicyId: 'test',
        policies: [policyData],
    })
}

function editor(): PolicyEditorState {
    const value = registry()
    return new PolicyEditorState(value, JSON.stringify(value.toData()))
}

describe('PolicyEditorState', () => {
    it('starts from the active policy', () => {
        const state = editor()
        expect(state.selectedPolicyId).toBe('test')
        expect(state.draft.label).toBe('Test policy')
        expect(state.draft.armValue).toBe('0.3')
        expect(state.draft.mandatoryUnit).toBe('ratio')
        expect(state.draft.forkOnMandatory).toBe(true)
    })

    it('selects a policy and resets the draft', () => {
        const value = registry()
        const state = new PolicyEditorState(
            value,
            JSON.stringify(value.toData())
        )
        const clone = value.clone('test', 'other')
        state.select(clone, 'other')
        expect(state.selectedPolicyId).toBe('other')
        expect(state.draft.id).toBe('other')
        expect(state.error).toBeUndefined()
    })

    it('round-trips every field between definition and draft', () => {
        const state = editor()
        const d = state.draft
        expect(d.hostHeadroomValue).toBe('0.1')
        expect(d.hostHeadroomUnit).toBe('ratio')
        expect(d.maxProbesPerCycle).toBe('5')
        expect(d.cacheFloor).toBe('0.7')
        expect(d.minProgressValue).toBe('0.15')
        expect(d.minProgressUnit).toBe('ratio')
        expect(d.injectNative).toBe(true)
        expect(state.toDefinition().toData()).toEqual(policyData)
    })

    it('edits text, units and both toggles', () => {
        const state = editor()
        const draft: PolicyDraft = state.draft
        state.updateText('label', 'Updated')
        state.updateUnit('armUnit', 'tokens')
        state.updateText('armValue', '100000')
        state.updateUnit('hostHeadroomUnit', 'tokens')
        state.updateText('hostHeadroomValue', '40000')
        state.updateText('maxProbesPerCycle', '0')
        state.updateText('cacheFloor', '0')
        state.updateUnit('minProgressUnit', 'tokens')
        state.updateText('minProgressValue', '25000')
        state.toggleForkOnMandatory()
        state.toggleInjectNative()

        expect(draft.label).toBe('Updated')
        expect(draft.armUnit).toBe('tokens')
        expect(draft.forkOnMandatory).toBe(false)
        expect(draft.injectNative).toBe(false)

        const definition = state.toDefinition().toData()
        expect(definition.label).toBe('Updated')
        expect(definition.thresholds.arm).toEqual({
            unit: 'tokens',
            value: 100_000,
        })
        expect(definition.thresholds.hostHeadroom).toEqual({
            unit: 'tokens',
            value: 40_000,
        })
        expect(definition.probe.maxProbesPerCycle).toBe(0)
        expect(definition.probe.cacheFloor).toBe(0)
        expect(definition.compaction.minProgress).toEqual({
            unit: 'tokens',
            value: 25_000,
        })
        expect(definition.compaction.forkOnMandatory).toBe(false)
        expect(definition.compaction.injectNative).toBe(false)

        state.toggleInjectNative()
        expect(state.draft.injectNative).toBe(true)
    })

    it('rejects invalid numbers and unsupported enum values', () => {
        const state = editor()
        state.updateText('armValue', '0')
        expect(() => state.toDefinition()).toThrow(/arm must be a positive/)
        state.updateText('armValue', '0.3')

        state.updateText('hostHeadroomValue', '-1')
        expect(() => state.toDefinition()).toThrow(
            /host headroom must be a positive number/
        )
        state.updateText('hostHeadroomValue', '0.1')

        state.updateText('minProgressValue', 'abc')
        expect(() => state.toDefinition()).toThrow(
            /minimum progress must be a positive number/
        )
        state.updateText('minProgressValue', '0.15')

        expect(() => state.updateUnit('armUnit', 'percent')).toThrow(
            /Unsupported threshold unit/
        )
        expect(() => state.select(registry(), 'missing')).toThrow(
            /Unknown policy/
        )
    })

    it('validates probe-count and cache-floor text', () => {
        const state = editor()
        state.updateText('maxProbesPerCycle', '2.5')
        expect(() => state.toDefinition()).toThrow(
            /max probes per cycle must be an integer/
        )
        state.updateText('maxProbesPerCycle', '-1')
        expect(() => state.toDefinition()).toThrow(
            /max probes per cycle must be a non-negative number/
        )
        state.updateText('maxProbesPerCycle', '101')
        expect(() => state.toDefinition()).toThrow(
            /maxProbesPerCycle must be an integer from 0 to 100/
        )
        state.updateText('maxProbesPerCycle', '5')

        state.updateText('cacheFloor', '')
        expect(() => state.toDefinition()).toThrow(
            /cache floor must be a non-negative number/
        )
        state.updateText('cacheFloor', '1.5')
        expect(() => state.toDefinition()).toThrow(
            /cacheFloor must be a number from 0 to 1/
        )
        state.updateText('cacheFloor', '1')
        expect(state.toDefinition().toData().probe.cacheFloor).toBe(1)
    })
})
