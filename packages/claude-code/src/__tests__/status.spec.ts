import { describe, expect, it } from 'vitest'
import {
    ContextPilotController,
    ContextPilotState,
    InstructionComposer,
    PolicyRegistry,
    ProbeDecisionParser,
    ProbeScheduler,
    SemanticProbePromptFactory,
} from '@intelligent-compact/core'
import { automationLabel, statusText } from '../presentation/status'

function controller(autoEnabled: boolean, hostCanCompact: boolean) {
    const registry = new PolicyRegistry({
        schemaVersion: 2,
        activePolicyId: 'test',
        policies: [
            {
                id: 'test',
                label: 'Test',
                thresholds: {
                    arm: { unit: 'tokens', value: 100 },
                    mandatory: { unit: 'tokens', value: 200 },
                    hostHeadroom: { unit: 'tokens', value: 10 },
                },
                probe: {
                    minGap: { unit: 'tokens', value: 10 },
                    maxGap: { unit: 'tokens', value: 40 },
                    maxProbesPerCycle: 4,
                    cacheFloor: 0.7,
                },
                compaction: {
                    minProgress: { unit: 'tokens', value: 20 },
                    directiveMaxChars: 50,
                    forkOnMandatory: true,
                    injectNative: true,
                    baseInstructions: 'base',
                },
            },
        ],
    })
    return new ContextPilotController(
        registry,
        new ContextPilotState(),
        {
            parser: new ProbeDecisionParser(),
            scheduler: new ProbeScheduler(),
            prompts: new SemanticProbePromptFactory(),
            composer: new InstructionComposer(),
        },
        { autoEnabled, hostCanCompact }
    )
}

describe('automationLabel', () => {
    it('distinguishes AUTO, MANUAL and OBSERVE', () => {
        expect(automationLabel(controller(true, true))).toBe('AUTO')
        expect(automationLabel(controller(false, true))).toBe('MANUAL')
        expect(automationLabel(controller(true, false))).toBe('OBSERVE')
        expect(automationLabel(controller(false, false))).toBe('MANUAL')
    })
})

describe('statusText', () => {
    it('reports an unresolved policy', () => {
        expect(statusText(controller(true, true))).toBe(
            'status · unresolved · —/— · next — · probes 0/— · AUTO · Not evaluated'
        )
    })

    it('appends errors and warnings', () => {
        const value = controller(true, false)
        value.snapshot.lastError = 'boom'
        value.snapshot.warnings = ['close to host autocompact']
        const text = statusText(value)
        expect(text).toContain('OBSERVE')
        expect(text).toContain('error: boom')
        expect(text).toContain('warning: close to host autocompact')
    })
})
