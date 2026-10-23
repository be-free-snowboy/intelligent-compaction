import { describe, expect, it } from 'vitest'
import { formatPercent, formatTokens } from '../shared/format'

describe('format', () => {
    it('formats token counts', () => {
        expect(formatTokens(undefined)).toBe('—')
        expect(formatTokens(Number.NaN)).toBe('—')
        expect(formatTokens(325_000)).toBe('325k')
        expect(formatTokens(999_999)).toBe('1000k')
        expect(formatTokens(1_000_000)).toBe('1.00M')
        expect(formatTokens(1_250_000)).toBe('1.25M')
    })

    it('formats percentages', () => {
        expect(formatPercent(undefined)).toBe('—')
        expect(formatPercent(12.345)).toBe('12.3%')
    })
})
