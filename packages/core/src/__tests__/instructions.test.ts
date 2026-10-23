import { describe, expect, it } from 'vitest'
import { DIRECTIVE_LABEL, InstructionComposer } from '../domain/instructions'

const composer = new InstructionComposer()

describe('InstructionComposer', () => {
    it('orders user text, base instructions, then the directive', () => {
        expect(
            composer.compose({
                user: ' focus on the parser ',
                base: 'Keep the ledger.',
                directive: 'lock order A→B; retry in tests/x.ts',
            })
        ).toBe(
            `focus on the parser\n\nKeep the ledger.\n\n${DIRECTIVE_LABEL} lock order A→B; retry in tests/x.ts`
        )
    })

    it('omits empty parts', () => {
        expect(
            composer.compose({
                user: '  ',
                base: 'Keep the ledger.',
                directive: '',
            })
        ).toBe('Keep the ledger.')
        expect(composer.compose({ base: 'Keep the ledger.' })).toBe(
            'Keep the ledger.'
        )
    })
})
