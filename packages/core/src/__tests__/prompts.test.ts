import { describe, expect, it } from 'vitest'
import {
    SemanticProbePromptFactory,
    type ProbePromptContext,
} from '../application/prompts'
import type { ResolvedPolicy } from '../domain/policy'

const policy: ResolvedPolicy = {
    id: 'p',
    label: 'P',
    arm: 325_000,
    mandatory: 500_000,
    hostHeadroom: 100_000,
    minGap: 15_000,
    maxGap: 50_000,
    maxProbesPerCycle: 5,
    cacheFloor: 0.7,
    minProgress: 150_000,
    directiveMaxChars: 1800,
    forkOnMandatory: true,
    injectNative: true,
    baseInstructions: 'Keep the ledger.',
}

const context: ProbePromptContext = {
    tokens: 400_000,
    window: 1_000_000,
    policy,
    meanDelta: 6000,
    p90Delta: 12_000,
    compactions: 1,
    tokensSinceCompaction: 370_000,
    probes: 2,
}

const prompts = new SemanticProbePromptFactory()

describe('SemanticProbePromptFactory', () => {
    it('ends the decision prompt with the per-call state block', () => {
        const prompt = prompts.decisionPrompt(context, {
            lower: 418_000,
            upper: 450_000,
        })
        const state = prompt.slice(prompt.indexOf('State:'))
        expect(state).toContain('context=400000/1000000')
        expect(state).toContain('headroom=100000')
        expect(state).toContain('avgTurnGrowth=6000 p90TurnGrowth=12000')
        expect(state).toContain('probesThisCycle=2/5')
        expect(state).toContain('nextProbeBounds=418000..450000')
        expect(state).toContain('directiveMaxChars=1800')
        expect(prompt).toContain('{"a":"W","n":<integer>,"r":"<reason>"}')
        expect(prompt).toContain('done, green, plan, switch (COMPACT)')
    })

    it('keeps the fixed text identical across probes', () => {
        const head = (tokens: number) => {
            const prompt = prompts.decisionPrompt(
                {
                    ...context,
                    tokens,
                    meanDelta: undefined,
                    p90Delta: undefined,
                },
                { lower: tokens, upper: tokens }
            )
            return prompt.slice(0, prompt.indexOf('State:'))
        }
        expect(head(330_000)).toBe(head(480_000))
        expect(
            prompts.decisionPrompt(
                { ...context, meanDelta: undefined },
                { lower: 1, upper: 2 }
            )
        ).toContain('avgTurnGrowth=unknown')
    })

    it('names the trigger in the mandatory directive prompt', () => {
        const prompt = prompts.mandatoryDirectivePrompt(
            context,
            'pre-mandatory'
        )
        expect(prompt).toContain('Compaction will run now (pre-mandatory).')
        expect(prompt).toContain('{"a":"C","i":"<directive>","r":"<reason>"}')
        expect(prompt).toContain('directiveMaxChars=1800')
    })
})
