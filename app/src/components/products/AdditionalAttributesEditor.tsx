'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ATTRIBUTE_TYPES,
  COMMON_ATTRIBUTE_NAMES,
  emptyStructuredAttribute,
  validateStructuredAttributes,
  type AttributeType,
  type StructuredAttribute,
} from '@/lib/products/structured-attributes'

interface AdditionalAttributesEditorProps {
  value: StructuredAttribute[]
  onChange: (value: StructuredAttribute[]) => void
  disabled?: boolean
}

export default function AdditionalAttributesEditor({ value, onChange, disabled = false }: AdditionalAttributesEditorProps) {
  const validation = validateStructuredAttributes(value)
  const update = (index: number, changes: Partial<StructuredAttribute>) => {
    onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row))
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
      <div>
        <Label className="text-sm font-semibold">Additional Attributes <span className="font-normal text-gray-500">(Optional)</span></Label>
        <p className="mt-1 text-xs text-gray-500">Add only the structured details relevant to this item.</p>
      </div>

      <datalist id="common-product-attribute-names">
        {COMMON_ATTRIBUTE_NAMES.map((name) => <option key={name} value={name} />)}
      </datalist>

      {value.map((row, index) => (
        <div key={row.id || `new-${index}`} className="space-y-1 rounded-md border border-gray-200 bg-white p-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1.2fr_1.5fr_0.7fr_0.8fr_auto]">
            <Input
              aria-label={`Attribute ${index + 1} name`}
              list="common-product-attribute-names"
              placeholder="Attribute"
              value={row.attribute_name}
              onChange={(event) => update(index, { attribute_name: event.target.value })}
              disabled={disabled}
            />
            <Input
              aria-label={`Attribute ${index + 1} value`}
              placeholder="Value"
              value={row.attribute_value}
              onChange={(event) => update(index, { attribute_value: event.target.value })}
              disabled={disabled}
            />
            <Input
              aria-label={`Attribute ${index + 1} unit`}
              placeholder="Unit"
              value={row.unit_of_measure || ''}
              onChange={(event) => update(index, { unit_of_measure: event.target.value || null })}
              disabled={disabled}
            />
            <Select value={row.attribute_type} onValueChange={(type) => update(index, { attribute_type: type as AttributeType })} disabled={disabled}>
              <SelectTrigger aria-label={`Attribute ${index + 1} type`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {ATTRIBUTE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove attribute ${index + 1}`} onClick={() => onChange(value.filter((_, rowIndex) => rowIndex !== index))} disabled={disabled} className="text-red-600">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {validation.errors[index] && <p className="text-xs text-red-600">{validation.errors[index]}</p>}
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, emptyStructuredAttribute(value.length)])} disabled={disabled}>
        <Plus className="mr-2 h-4 w-4" /> Add Attribute
      </Button>
    </div>
  )
}
