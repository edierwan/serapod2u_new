'use client'

import { useMemo, useState } from 'react'
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

interface AdditionalAttributesEditorProps {
  value: StructuredAttribute[]
  onChange: (value: StructuredAttribute[]) => void
  disabled?: boolean
  showValidationErrors?: boolean
}

const COLOUR_NAMES = [
  'Black', 'White', 'Grey', 'Red', 'Blue', 'Green', 'Brown', 'Beige', 'Sand',
  'Orange', 'Yellow', 'Pink', 'Purple', 'Burgundy', 'Burgundy Sand', 'Matcha Berry', 'Orange Grey',
]

const COMMON_COLOUR_HEX: Record<string, string> = {
  black: '#0D0D0D',
  white: '#FFFFFF',
  grey: '#808080',
  red: '#DC2626',
  blue: '#2563EB',
  green: '#16A34A',
  brown: '#8B5E3C',
  beige: '#D6C6A5',
  sand: '#C2B280',
  orange: '#F97316',
  yellow: '#EAB308',
  pink: '#EC4899',
  purple: '#9333EA',
  burgundy: '#76232F',
  'burgundy sand': '#76232F',
  'matcha berry': '#5E6738',
  'orange grey': '#7C878E',
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
}: AdditionalAttributesEditorProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const validation = validateStructuredAttributes(value)

  const colourIndexes = useMemo(() => value.reduce<number[]>((indexes, row, index) => {
    const name = normalizeAttributeName(row.attribute_name)
    if (name === 'colour' || name === 'colour hex') indexes.push(index)
    return indexes
  }, []), [value])

  const colourIndex = value.findIndex((row) => normalizeAttributeName(row.attribute_name) === 'colour')
  const colourHexIndex = value.findIndex((row) => normalizeAttributeName(row.attribute_name) === 'colour hex')
  const firstColourIndex = colourIndexes[0] ?? -1

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

  const updateColourName = (name: string) => {
    const suggestedHex = COMMON_COLOUR_HEX[normalizeAttributeName(name)]
    const next = value.map((row) => {
      const normalized = normalizeAttributeName(row.attribute_name)
      if (normalized === 'colour') return { ...row, attribute_value: name }
      if (normalized === 'colour hex' && suggestedHex) return { ...row, attribute_value: suggestedHex }
      return row
    })
    if (colourIndex < 0) {
      next.push({ attribute_name: 'Colour', attribute_value: name, attribute_type: 'TEXT', unit_of_measure: null, display_order: next.length, is_draft: true })
    }
    if (suggestedHex && colourHexIndex < 0) {
      next.push({ attribute_name: 'Colour Hex', attribute_value: suggestedHex, attribute_type: 'TEXT', unit_of_measure: null, display_order: next.length, is_draft: true })
    }
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
        {COLOUR_NAMES.map((name) => <option key={name} value={name} />)}
      </datalist>

      {value.map((row, index) => {
        const normalizedName = normalizeAttributeName(row.attribute_name)
        if ((normalizedName === 'colour' || normalizedName === 'colour hex') && index !== firstColourIndex) return null

        if (index === firstColourIndex) {
          const colour = colourIndex >= 0 ? value[colourIndex] : null
          const colourHex = colourHexIndex >= 0 ? value[colourHexIndex] : null
          const error = showError('colour', colourIndexes)
          const pickerValue = /^#[0-9a-f]{6}$/i.test(colourHex?.attribute_value || '') ? colourHex!.attribute_value : '#000000'
          return (
            <div key="smart-colour" className="space-y-3 rounded-md border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <Label className="font-medium">Colour</Label>
                <Button type="button" variant="ghost" size="sm" aria-label="Remove Colour" onClick={() => onChange(value.filter((_, rowIndex) => !colourIndexes.includes(rowIndex)))} disabled={disabled} className="text-red-600"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-1">
                  <Label htmlFor="smart-colour-name" className="text-xs">Colour Name</Label>
                  <Input id="smart-colour-name" list="common-colour-names" placeholder="Black or Burgundy Sand" value={colour?.attribute_value || ''} onChange={(event) => updateColourName(event.target.value)} onBlur={() => markTouched('colour')} disabled={disabled} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="smart-colour-picker" className="text-xs">Colour</Label>
                  <Input id="smart-colour-picker" aria-label="Colour picker" type="color" value={pickerValue} onChange={(event) => updateOrAddColourRow('Colour Hex', { attribute_value: event.target.value.toUpperCase() })} onBlur={() => markTouched('colour')} disabled={disabled} className="h-10 w-20 cursor-pointer p-1" />
                </div>
              </div>
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
