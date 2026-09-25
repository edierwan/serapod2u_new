'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ATTRIBUTE_PRESETS,
  createPresetAttributes,
  hasAttributePreset,
  normalizeAttributeName,
  validateStructuredAttributes,
  type AttributePresetKey,
  type StructuredAttribute,
} from '@/lib/products/structured-attributes'
import {
  FALLBACK_COLOUR_REFERENCE,
  hexToRgb,
  loadColourReferencePalette,
  nearestColour,
  normalizeColourHex,
  type ColourReference,
} from '@/lib/products/colour-reference'

interface AdditionalAttributesEditorProps {
  value: StructuredAttribute[]
  onChange: (value: StructuredAttribute[]) => void
  disabled?: boolean
  showValidationErrors?: boolean
  colourReferenceClient?: any
}

const UNIT_OPTIONS: Record<string, string[]> = {
  capacity: ['ml', 'L'],
  weight: ['g', 'kg'],
  max_load: ['kg'],
  power: ['W', 'kW'],
  volume: ['ml', 'L'],
}

const PLACEHOLDERS: Record<string, string> = {
  capacity: '1',
  size: 'Large, XL, 120 x 60 cm',
  weight: '1',
  material: 'Stainless Steel',
  max_load: '120',
  power: '1.5',
  volume: '750',
}

function presetForName(name: string): Exclude<AttributePresetKey, 'colour' | 'custom'> | null {
  const normalized = normalizeAttributeName(name)
  const preset = ATTRIBUTE_PRESETS.find((item) => item.key !== 'colour' && normalizeAttributeName(item.label) === normalized)
  return (preset?.key as Exclude<AttributePresetKey, 'colour' | 'custom'> | undefined) || null
}

export default function AdditionalAttributesEditor({
  value,
  onChange,
  disabled = false,
  showValidationErrors = false,
  colourReferenceClient,
}: AdditionalAttributesEditorProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [colourNameMode, setColourNameMode] = useState<'auto' | 'manual'>(() => {
    const existing = value.find((row) => normalizeAttributeName(row.attribute_name) === 'colour')
    return !existing || existing.is_draft ? 'auto' : 'manual'
  })
  const [colourPalette, setColourPalette] = useState<ColourReference[]>(FALLBACK_COLOUR_REFERENCE)
  const validation = validateStructuredAttributes(value)

  const colourIndexes = useMemo(() => value.reduce<number[]>((indexes, row, index) => {
    const name = normalizeAttributeName(row.attribute_name)
    if (name === 'colour' || name === 'colour hex') indexes.push(index)
    return indexes
  }, []), [value])

  const colourIndex = value.findIndex((row) => normalizeAttributeName(row.attribute_name) === 'colour')
  const colourHexIndex = value.findIndex((row) => normalizeAttributeName(row.attribute_name) === 'colour hex')
  const firstColourIndex = colourIndexes[0] ?? -1

  useEffect(() => {
    if (colourIndexes.length === 0) return
    let active = true
    loadColourReferencePalette(colourReferenceClient).then((palette) => {
      if (active) setColourPalette(palette)
    })
    return () => { active = false }
  }, [colourIndexes.length, colourReferenceClient])

  const update = (index: number, changes: Partial<StructuredAttribute>) => {
    onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row))
  }

  const updateOrAddColourRow = (name: 'Colour' | 'Colour Hex', changes: Partial<StructuredAttribute>) => {
    const normalized = normalizeAttributeName(name)
    const index = value.findIndex((row) => normalizeAttributeName(row.attribute_name) === normalized)
    if (index >= 0) return update(index, changes)
    onChange([
      ...value,
      {
        attribute_name: name,
        attribute_value: '',
        attribute_type: 'TEXT',
        unit_of_measure: null,
        display_order: value.length,
        is_draft: true,
        ...changes,
      },
    ])
  }

  const colourRow = (name: 'Colour' | 'Colour Hex', attributeValue: string, displayOrder: number): StructuredAttribute => ({
    attribute_name: name,
    attribute_value: attributeValue,
    attribute_type: 'TEXT',
    unit_of_measure: null,
    display_order: displayOrder,
    is_draft: true,
  })

  const updateColourHex = (rawHex: string) => {
    const displayHex = rawHex.toUpperCase()
    const rgb = hexToRgb(displayHex)
    const suggestion = rgb ? nearestColour(rgb, colourPalette)?.colour_name : null
    const next = value.map((row) => {
      const normalized = normalizeAttributeName(row.attribute_name)
      if (normalized === 'colour hex') return { ...row, attribute_value: displayHex }
      if (normalized === 'colour' && colourNameMode === 'auto' && suggestion) return { ...row, attribute_value: suggestion }
      return row
    })
    if (colourHexIndex < 0) next.push(colourRow('Colour Hex', displayHex, next.length))
    if (colourIndex < 0) next.push(colourRow('Colour', colourNameMode === 'auto' ? suggestion || '' : '', next.length))
    onChange(next)
  }

  const addPreset = (preset: AttributePresetKey) => {
    onChange([...value, ...createPresetAttributes(preset, value.length)])
    setMenuOpen(false)
  }

  const markTouched = (key: string) => setTouched((current) => ({ ...current, [key]: true }))
  const showError = (key: string, indexes: number[]) => {
    if (!showValidationErrors && !touched[key]) return null
    return indexes.map((index) => validation.errors[index]).find(Boolean) || null
  }

  const availablePresets = ATTRIBUTE_PRESETS.filter((preset) => !hasAttributePreset(value, preset.key))

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
      <div>
        <Label className="text-sm font-semibold">Additional Attributes <span className="font-normal text-gray-500">(Optional)</span></Label>
        <p className="mt-1 text-xs text-gray-500">Add only the details relevant to this item.</p>
      </div>

      <datalist id="common-colour-names">
        {colourPalette.map((colour) => <option key={colour.hex_code} value={colour.colour_name} />)}
      </datalist>

      {value.map((row, index) => {
        const normalizedName = normalizeAttributeName(row.attribute_name)
        if ((normalizedName === 'colour' || normalizedName === 'colour hex') && index !== firstColourIndex) return null

        if (index === firstColourIndex) {
          const colour = colourIndex >= 0 ? value[colourIndex] : null
          const colourHex = colourHexIndex >= 0 ? value[colourHexIndex] : null
          const error = (!showValidationErrors && !touched.colour)
            ? null
            : (validation.errors[colourHexIndex] || validation.errors[colourIndex] || null)
          const validHex = normalizeColourHex(colourHex?.attribute_value || '')
          const pickerValue = validHex || '#000000'
          const rgb = validHex ? hexToRgb(validHex) : null
          const suggestion = rgb ? nearestColour(rgb, colourPalette)?.colour_name || null : null
          const showSuggestion = colourNameMode === 'manual' && suggestion && normalizeAttributeName(suggestion) !== normalizeAttributeName(colour?.attribute_value || '')
          return (
            <div key="smart-colour" className="space-y-3 rounded-md border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <Label className="font-medium">Colour</Label>
                <Button type="button" variant="ghost" size="sm" aria-label="Remove Colour" onClick={() => onChange(value.filter((_, rowIndex) => !colourIndexes.includes(rowIndex)))} disabled={disabled} className="text-red-600"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(150px,0.55fr)] sm:items-end">
                <div className="space-y-1">
                  <Label htmlFor="smart-colour-name" className="text-xs">Colour Name</Label>
                  <Input id="smart-colour-name" list="common-colour-names" placeholder="Black or Burgundy Sand" value={colour?.attribute_value || ''} onChange={(event) => { setColourNameMode('manual'); updateOrAddColourRow('Colour', { attribute_value: event.target.value }) }} onBlur={() => markTouched('colour')} disabled={disabled} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="smart-colour-picker" className="text-xs">Colour</Label>
                  <Input id="smart-colour-picker" aria-label="Colour picker" type="color" value={pickerValue} onChange={(event) => updateColourHex(event.target.value)} onBlur={() => markTouched('colour')} disabled={disabled} className="h-10 w-20 cursor-pointer p-1" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="smart-colour-hex" className="text-xs">HEX</Label>
                  <Input id="smart-colour-hex" aria-label="Colour HEX" placeholder="#RRGGBB" value={colourHex?.attribute_value || ''} onChange={(event) => updateColourHex(event.target.value)} onBlur={() => markTouched('colour')} disabled={disabled} className="font-mono uppercase" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2" aria-label="RGB representation">
                {(['red', 'green', 'blue'] as const).map((channel) => (
                  <div key={channel} className="space-y-1">
                    <Label className="text-[11px] uppercase text-gray-500">{channel[0]}</Label>
                    <Input aria-label={`${channel} value`} value={rgb?.[channel] ?? ''} readOnly className="h-8 bg-gray-50 text-sm tabular-nums" />
                  </div>
                ))}
              </div>
              {showSuggestion && (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span>Suggested: {suggestion}</span>
                  <Button type="button" variant="outline" size="sm" className="h-7" disabled={disabled} onClick={() => { setColourNameMode('auto'); updateOrAddColourRow('Colour', { attribute_value: suggestion }) }}>Use suggestion</Button>
                </div>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          )
        }

        const preset = presetForName(row.attribute_name)
        const touchKey = row.id || `row-${index}`
        const error = showError(touchKey, [index])
        if (preset) {
          const units = UNIT_OPTIONS[preset]
          return (
            <div key={row.id || `${preset}-${index}`} className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <Label className="font-medium">{row.attribute_name}</Label>
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${row.attribute_name}`} onClick={() => onChange(value.filter((_, rowIndex) => rowIndex !== index))} disabled={disabled} className="text-red-600"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className={units ? 'grid grid-cols-[1fr_90px] gap-2' : ''}>
                <Input aria-label={`${row.attribute_name} value`} type={units ? 'number' : 'text'} step={units ? 'any' : undefined} placeholder={PLACEHOLDERS[preset]} value={row.attribute_value} onChange={(event) => update(index, { attribute_value: event.target.value })} onBlur={() => markTouched(touchKey)} disabled={disabled} />
                {units && (
                  <select aria-label={`${row.attribute_name} unit`} value={row.unit_of_measure || units[0]} onChange={(event) => update(index, { unit_of_measure: event.target.value })} disabled={disabled || units.length === 1} className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm">
                    {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                )}
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          )
        }

        return (
          <div key={row.id || `custom-${index}`} className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <Label className="font-medium">Custom Attribute</Label>
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove custom attribute ${index + 1}`} onClick={() => onChange(value.filter((_, rowIndex) => rowIndex !== index))} disabled={disabled} className="text-red-600"><Trash2 className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1.4fr_0.7fr]">
              <Input aria-label={`Custom attribute ${index + 1} name`} placeholder="Name, e.g. Frame Material" value={row.attribute_name} onChange={(event) => update(index, { attribute_name: event.target.value })} onBlur={() => markTouched(touchKey)} disabled={disabled} />
              <Input aria-label={`Custom attribute ${index + 1} value`} placeholder="Value, e.g. Aluminium" value={row.attribute_value} onChange={(event) => update(index, { attribute_value: event.target.value })} onBlur={() => markTouched(touchKey)} disabled={disabled} />
              <Input aria-label={`Custom attribute ${index + 1} unit`} placeholder="Unit (optional)" value={row.unit_of_measure || ''} onChange={(event) => update(index, { unit_of_measure: event.target.value || null })} onBlur={() => markTouched(touchKey)} disabled={disabled} />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        )
      })}

      <div className="relative inline-block">
        <Button type="button" variant="outline" size="sm" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} disabled={disabled}><Plus className="mr-2 h-4 w-4" /> Add Attribute</Button>
        {menuOpen && (
          <div role="menu" aria-label="Attribute presets" className="absolute left-0 top-full z-40 mt-1 min-w-52 rounded-md border border-gray-200 bg-white p-1 shadow-lg">
            {availablePresets.map((preset) => <button key={preset.key} type="button" role="menuitem" onClick={() => addPreset(preset.key)} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-100">{preset.label}</button>)}
            {availablePresets.length > 0 && <div className="my-1 h-px bg-gray-200" />}
            <button type="button" role="menuitem" onClick={() => addPreset('custom')} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-100">Custom Attribute</button>
          </div>
        )}
      </div>
    </div>
  )
}
