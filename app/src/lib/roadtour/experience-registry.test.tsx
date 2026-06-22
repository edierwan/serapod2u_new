import { describe, expect, it } from 'vitest'
import {
    getRoadtourExperienceForCategory,
    isRoadtourCategorySelectable,
    resolveRoadtourExperience,
    resolveCategoryTemplateKey,
    type RoadtourProductCategory,
} from './experience-registry'

const category = (overrides: Partial<RoadtourProductCategory> = {}): RoadtourProductCategory => ({
    id: 'category-id',
    category_code: 'VAPE',
    category_name: 'Vape',
    is_active: true,
    is_vape: true,
    image_url: null,
    ...overrides,
})

describe('RoadTour experience registry', () => {
    it('maps Vape to the active existing experience', () => {
        expect(getRoadtourExperienceForCategory(category())?.key).toBe('vape')
        expect(isRoadtourCategorySelectable(category())).toBe(true)
    })

    it.each([
        ['Electronic', 'electronic'],
        ['Outdoor', 'outdoor'],
    ])('maps %s but keeps its experience inactive (Coming soon)', (name, key) => {
        const value = category({ category_code: name, category_name: name, is_vape: false })
        expect(getRoadtourExperienceForCategory(value)?.key).toBe(key)
        expect(isRoadtourCategorySelectable(value)).toBe(false)
        expect(resolveRoadtourExperience(value).key).toBe('vape')
    })

    it('maps Pet Food to its active experience and the pet_food template', () => {
        const value = category({ category_code: 'PET-588097', category_name: 'Pet Food', is_vape: false })
        expect(getRoadtourExperienceForCategory(value)?.key).toBe('pet_food')
        expect(isRoadtourCategorySelectable(value)).toBe(true)
        expect(resolveRoadtourExperience(value).key).toBe('pet_food')
        expect(resolveCategoryTemplateKey(value)).toBe('pet_food')
    })

    it('falls back to Vape/premium for null, inactive, and unmapped categories', () => {
        expect(resolveRoadtourExperience(null).key).toBe('vape')
        expect(resolveRoadtourExperience(category({ is_active: false })).key).toBe('vape')
        expect(resolveRoadtourExperience(category({ category_code: 'OTHER', category_name: 'Other', is_vape: false })).key).toBe('vape')
        expect(resolveCategoryTemplateKey(null)).toBe('premium')
        expect(resolveCategoryTemplateKey(category())).toBe('premium')
        expect(resolveCategoryTemplateKey(category({ category_code: 'PET-1', category_name: 'Pet Food', is_active: false, is_vape: false }))).toBe('premium')
    })
})
