export interface RoadtourSurveyTemplateSeedField {
    field_key: string
    label: string
    field_type: string
    is_required: boolean
    options: string[] | null
    source_column: keyof RoadtourShopSurveySource
    description: string
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
        field_type: 'text',
        is_required: false,
        options: null,
        source_column: 'hot_flavour_brands',
        description: 'Linked to the shop master data value for Hot Flavour Brands.',
    },
    {
        field_key: 'sells_serapod_flavour',
        label: 'Sells Flavour Serapod',
        field_type: 'yes_no',
        is_required: false,
        options: null,
        source_column: 'sells_serapod_flavour',
        description: 'Linked to the shop master data flag for Sells Flavour Serapod.',
    },
    {
        field_key: 'sells_sbox',
        label: 'Sells S.Box',
        field_type: 'yes_no',
        is_required: false,
        options: null,
        source_column: 'sells_sbox',
        description: 'Linked to the shop master data flag for Sells S.Box.',
    },
    {
        field_key: 'sells_sbox_special_edition',
        label: 'Sells S.Box Special Edition',
        field_type: 'yes_no',
        is_required: false,
        options: null,
        source_column: 'sells_sbox_special_edition',
        description: 'Linked to the shop master data flag for Sells S.Box Special Edition.',
    },
]

const ROADTOUR_SHOP_SURVEY_FIELD_LOOKUP = new Map(
    ROADTOUR_SHOP_SURVEY_FIELDS.map((field) => [field.field_key, field])
)

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

export function getRoadtourShopSurveyField(fieldKey: string) {
    return ROADTOUR_SHOP_SURVEY_FIELD_LOOKUP.get(fieldKey) ?? null
}