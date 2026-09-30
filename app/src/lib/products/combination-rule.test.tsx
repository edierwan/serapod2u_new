import { describe, expect, it } from 'vitest'
import { needsUniqueCombination } from './combination-rule'

describe('needsUniqueCombination', () => {
  it('keeps the unique combination rule for main-catalogue products', () => {
    expect(needsUniqueCombination({ outdoor_store: false })).toBe(true)
    expect(needsUniqueCombination({})).toBe(true)
    expect(needsUniqueCombination({ outdoor_store: null })).toBe(true)
  })

  it('lets Outdoor store products share brand, category, group, subgroup and manufacturer', () => {
    expect(needsUniqueCombination({ outdoor_store: true })).toBe(false)
  })
})
