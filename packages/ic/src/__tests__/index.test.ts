import { describe, expect, it } from 'vitest'
import { value } from '../index'

describe('ic', () => {
    it('exports the starter value', () => {
        expect(value).toBe(2)
    })
})
