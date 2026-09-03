/**
 * Display unit for the stock-configuration "volume" dimension.
 *
 * The dimension is stored as `inventory_stock_configurations.volume_ml` and
 * baked into stored labels ("20ml · New Box"), config codes ("20NB") and the
 * configuration keys derived from those labels. Operationally the number is
 * read as a nicotine strength in milligrams, not a liquid volume, so the UI
 * says "20 mg" while the column, codes, stored labels and keys keep their
 * historical `ml` spelling.
 *
 * That split is deliberate: renaming the stored labels would break
 * `configurationFilterKey`-style keys (see CELLERA_DEFAULT_CONFIGURATION_KEY in
 * add-stock-inventory.ts), stock-config codes, and every migration that pins
 * them. Everything here is therefore presentation-only and pure, so the
 * rewriting is unit testable on its own.
 */

/** Unit shown to operators for the stock-configuration strength dimension. */
export const STOCK_STRENGTH_UNIT = 'mg'

/** Any "<number>ml" / "<number> ml" run inside a stored or derived label. */
const STORED_VOLUME_UNIT = /(\d+)\s*ml\b/gi

/**
 * "20" → "20 mg". Null/undefined volumes (Legacy, Standard, dimensionless
 * Device configurations) render as an em dash so the cell never reads " mg".
 */
export function formatStockStrength(
  volume?: number | string | null,
  emptyLabel = '—',
): string {
  if (volume === null || volume === undefined || volume === '') return emptyLabel
  const amount = Number(volume)
  if (!Number.isFinite(amount)) return emptyLabel
  return `${amount} ${STOCK_STRENGTH_UNIT}`
}

/**
 * Rewrites the unit inside a stored or composed label:
 * "20ml · New Box" → "20 mg · New Box", "50ml New Box" → "50 mg New Box".
 * Text with no volume run is returned unchanged, so it is safe to wrap any
 * label whose origin is mixed (stored `config_label`, server message, or a
 * locally composed string).
 */
export function withStockStrengthUnit<T extends string | null | undefined>(label: T): T {
  if (!label) return label
  return label.replace(STORED_VOLUME_UNIT, `$1 ${STOCK_STRENGTH_UNIT}`) as T
}
