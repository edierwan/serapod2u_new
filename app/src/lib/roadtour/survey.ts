export interface RoadtourSurveyTemplateSeedField {
    field_key: string
    label: string
    field_type: string
    is_required: boolean
    options: string[] | null
}

export interface RoadtourShopSurveySource {
    hot_flavour_brands?: string | null
    sells_serapod_flavour?: boolean | null
    sells_sbox?: boolean | null
    sells_sbox_special_edition?: boolean | null
}

export const ROADTOUR_SHOP_SURVEY_FIELDS: RoadtourSurveyTemplateSeedField[] = [
    {
        field_key: 'hot_flavour_brands',
        label: 'Hot Flavour Brands',
        field_type: 'textarea',
        is_required: false,
        options: null,
    },
    {
        field_key: 'sells_serapod_flavour',
        label: 'Sells Serapod Flavour',
        field_type: 'yes_no',
        is_required: false,
        options: null,
    },
    {
        field_key: 'sells_sbox',
        label: 'Sells S.Box',
        field_type: 'yes_no',
        is_required: false,
        options: null,
    },
    {
        field_key: 'sells_sbox_special_edition',
        label: 'Sells S.Box Special Edition',
        field_type: 'yes_no',
        is_required: false,
        options: null,
    },
]

const toYesNo = (value: boolean | null | undefined) => {
    if (value === true) return 'yes'
    if (value === false) return 'no'
    return ''
}

export function getRoadtourShopSurveyPrefillValues(shop: RoadtourShopSurveySource | null | undefined): Record<string, string> {
    if (!shop) return {}

    return {
        hot_flavour_brands: shop.hot_flavour_brands?.trim() || '',
        sells_serapod_flavour: toYesNo(shop.sells_serapod_flavour),
        sells_sbox: toYesNo(shop.sells_sbox),
        sells_sbox_special_edition: toYesNo(shop.sells_sbox_special_edition),
    }
}