import { describe, expect, it } from 'vitest'
import {
  evaluateStockConfigEligibility,
  findIneligibleStockConfigs,
  isConcentrationConfig,
  isStockConfigEligible,
  resolveStockConfigProfile,
  type AssertableStockConfigRow,
} from './stock-count-config-eligibility'

describe('Stock Count configuration eligibility model', () => {
  describe('resolveStockConfigProfile', () => {
    it('accepts the two explicit profiles', () => {
      expect(resolveStockConfigProfile('concentration')).toBe('concentration')
      expect(resolveStockConfigProfile('standard')).toBe('standard')
    })
    it('falls back to concentration when unknown/null so nothing is hidden pre-backfill', () => {
      expect(resolveStockConfigProfile(null)).toBe('concentration')
      expect(resolveStockConfigProfile(undefined)).toBe('concentration')
      expect(resolveStockConfigProfile('device')).toBe('concentration')
    })
  })

  describe('isConcentrationConfig', () => {
    it('detects concentration configs by code, volume, or packaging', () => {
      expect(isConcentrationConfig({ configCode: '20NB', volumeMl: 20, packaging: 'new_box' })).toBe(true)
      expect(isConcentrationConfig({ configCode: '50NB', volumeMl: 50, packaging: 'new_box' })).toBe(true)
      expect(isConcentrationConfig({ configCode: '50OB', volumeMl: 50, packaging: 'old_box' })).toBe(true)
      expect(isConcentrationConfig({ configCode: 'CUSTOM', volumeMl: 30, packaging: null })).toBe(true)
      expect(isConcentrationConfig({ configCode: 'CUSTOM', volumeMl: null, packaging: 'old_box' })).toBe(true)
    })
    it('treats Standard/Unclassified as non-concentration', () => {
      expect(isConcentrationConfig({ configCode: 'STD', volumeMl: null, packaging: null })).toBe(false)
      expect(isConcentrationConfig({ configCode: 'UNCLASSIFIED', volumeMl: null, packaging: null })).toBe(false)
    })
  })

  describe('Cartridge / flavour group (concentration profile)', () => {
    it('keeps 20mg and 50mg New Box eligible', () => {
      for (const configCode of ['20NB', '50NB', '50OB']) {
        expect(isStockConfigEligible({
          configCode, volumeMl: configCode.startsWith('20') ? 20 : 50,
          packaging: configCode.endsWith('OB') ? 'old_box' : 'new_box',
          groupProfile: 'concentration', hasActivity: false,
        })).toBe(true)
      }
    })
    it('shows Unclassified only while legacy stock still needs classification', () => {
      const base = { configCode: 'UNCLASSIFIED', volumeMl: null, packaging: null, groupProfile: 'concentration' as const }
      expect(isStockConfigEligible({ ...base, hasActivity: true })).toBe(true)
      const result = evaluateStockConfigEligibility({ ...base, hasActivity: false })
      expect(result.eligible).toBe(false)
      expect(result.reason).toBe('unclassified_without_balance')
    })
  })

  describe('Device group (standard profile)', () => {
    it('rejects 20mg/50mg/New Box concentration configurations', () => {
      for (const configCode of ['20NB', '50NB', '50OB']) {
        const result = evaluateStockConfigEligibility({
          configCode, volumeMl: configCode.startsWith('20') ? 20 : 50,
          packaging: configCode.endsWith('OB') ? 'old_box' : 'new_box',
          groupProfile: 'standard', hasActivity: false,
        })
        expect(result.eligible).toBe(false)
        expect(result.reason).toBe('concentration_config_on_non_flavour_group')
      }
    })
    it('rejects a concentration config even when it carries a balance (still ineligible for posting)', () => {
      expect(isStockConfigEligible({
        configCode: '20NB', volumeMl: 20, packaging: 'new_box', groupProfile: 'standard', hasActivity: true,
      })).toBe(false)
    })
    it('accepts exactly the Standard/Device configuration', () => {
      expect(isStockConfigEligible({
        configCode: 'STD', volumeMl: null, packaging: null, groupProfile: 'standard', hasActivity: false,
      })).toBe(true)
    })
    it('keeps an existing Device Unclassified balance countable (for later transfer to Standard)', () => {
      expect(isStockConfigEligible({
        configCode: 'UNCLASSIFIED', volumeMl: null, packaging: null, groupProfile: 'standard', hasActivity: true,
      })).toBe(true)
    })
  })

  describe('Non-Vape groups (standard profile) do not inherit Vape rules', () => {
    it.each(['Speaker', 'Camping', 'Cat Treat'])('%s rejects concentration configurations', () => {
      expect(isStockConfigEligible({
        configCode: '50NB', volumeMl: 50, packaging: 'new_box', groupProfile: 'standard', hasActivity: false,
      })).toBe(false)
    })
  })

  describe('findIneligibleStockConfigs (backend/posting guard)', () => {
    const rows: AssertableStockConfigRow[] = [
      { stockConfigId: 'dev-20nb', configCode: '20NB', variantId: 'device-1', volumeMl: 20, packaging: 'new_box', groupProfile: 'standard', hasActivity: true },
      { stockConfigId: 'dev-std', configCode: 'STD', variantId: 'device-1', volumeMl: null, packaging: null, groupProfile: 'standard', hasActivity: true },
      { stockConfigId: 'cart-50nb', configCode: '50NB', variantId: 'cartridge-1', volumeMl: 50, packaging: 'new_box', groupProfile: 'concentration', hasActivity: false },
    ]
    it('flags only the invalid Device concentration configuration', () => {
      const violations = findIneligibleStockConfigs(rows)
      expect(violations).toHaveLength(1)
      expect(violations[0].stockConfigId).toBe('dev-20nb')
      expect(violations[0].reason).toBe('concentration_config_on_non_flavour_group')
      expect(violations[0].message).toMatch(/not valid for this product group/i)
    })
    it('returns no violations for a clean cartridge + device standard submission', () => {
      expect(findIneligibleStockConfigs([rows[1], rows[2]])).toEqual([])
    })
  })
})
