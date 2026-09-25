// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AdditionalAttributesEditor from './AdditionalAttributesEditor'
import type { StructuredAttribute } from '@/lib/products/structured-attributes'

const row = (name: string, value: string, unit: string | null = null, type: StructuredAttribute['attribute_type'] = 'TEXT'): StructuredAttribute => ({
  attribute_name: name,
  attribute_value: value,
  attribute_type: type,
  unit_of_measure: unit,
  display_order: 0,
})

function Harness({ initial = [], showValidationErrors = false }: { initial?: StructuredAttribute[]; showValidationErrors?: boolean }) {
  const [value, setValue] = useState(initial)
  return <><AdditionalAttributesEditor value={value} onChange={setValue} showValidationErrors={showValidationErrors} /><output data-testid="value">{JSON.stringify(value)}</output></>
}

const currentRows = () => JSON.parse(screen.getByTestId('value').textContent || '[]') as StructuredAttribute[]
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Add Attribute' }))

describe('AdditionalAttributesEditor smart presets', () => {
  afterEach(cleanup)

  it('starts empty and opens preset choices without a blank row', () => {
    render(<Harness />)
    expect(screen.queryByRole('textbox')).toBeNull()
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Colour' })).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Capacity' })).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Custom Attribute' })).not.toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Colour Hex' })).toBeNull()
  })

  it('renders one smart Colour control while managing Colour and Colour Hex rows', () => {
    render(<Harness />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Colour' }))
    expect(screen.getByLabelText('Colour Name')).not.toBeNull()
    expect(screen.getByLabelText('Colour picker')).not.toBeNull()
    expect(screen.getByLabelText('Colour HEX')).not.toBeNull()
    expect(currentRows().map((item) => item.attribute_name)).toEqual(['Colour', 'Colour Hex'])
    expect(currentRows()[1].attribute_value).toBe('#000000')

    fireEvent.change(screen.getByLabelText('Colour picker'), { target: { value: '#4169e1' } })
    expect(currentRows().map((item) => [item.attribute_name, item.attribute_value])).toEqual([
      ['Colour', 'Royal Blue'],
      ['Colour Hex', '#4169E1'],
    ])
    expect((screen.getByLabelText('red value') as HTMLInputElement).value).toBe('65')
    expect((screen.getByLabelText('green value') as HTMLInputElement).value).toBe('105')
    expect((screen.getByLabelText('blue value') as HTMLInputElement).value).toBe('225')
  })

  it('keeps picker, HEX, and RGB in sync while the name remains automatic', () => {
    render(<Harness />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Colour' }))
    fireEvent.change(screen.getByLabelText('Colour HEX'), { target: { value: '#ff0000' } })
    expect((screen.getByLabelText('Colour HEX') as HTMLInputElement).value).toBe('#FF0000')
    expect((screen.getByLabelText('Colour picker') as HTMLInputElement).value.toLowerCase()).toBe('#ff0000')
    expect((screen.getByLabelText('Colour Name') as HTMLInputElement).value).toBe('Red')
    expect((screen.getByLabelText('red value') as HTMLInputElement).value).toBe('255')
    expect((screen.getByLabelText('green value') as HTMLInputElement).value).toBe('0')
  })

  it('preserves a manually edited name when the colour changes and offers the nearest suggestion', () => {
    render(<Harness />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Colour' }))
    fireEvent.change(screen.getByLabelText('Colour Name'), { target: { value: 'House Blue' } })
    fireEvent.change(screen.getByLabelText('Colour picker'), { target: { value: '#0000ff' } })
    expect((screen.getByLabelText('Colour Name') as HTMLInputElement).value).toBe('House Blue')
    expect(screen.getByText('Suggested: Blue')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Use suggestion' }))
    expect((screen.getByLabelText('Colour Name') as HTMLInputElement).value).toBe('Blue')
  })

  it('allows incomplete HEX typing and validates it on blur', () => {
    render(<Harness />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Colour' }))
    fireEvent.change(screen.getByLabelText('Colour HEX'), { target: { value: '#12' } })
    expect((screen.getByLabelText('Colour HEX') as HTMLInputElement).value).toBe('#12')
    expect(screen.queryByText('HEX must use #RRGGBB.')).toBeNull()
    fireEvent.blur(screen.getByLabelText('Colour HEX'))
    expect(screen.getByText('HEX must use #RRGGBB.')).not.toBeNull()
  })

  it('loads an existing Colour pair as one smart row and removes both together', () => {
    render(<Harness initial={[row('Colour', 'Black'), row('Colour Hex', '#0D0D0D')]} />)
    expect((screen.getByLabelText('Colour Name') as HTMLInputElement).value).toBe('Black')
    expect((screen.getByLabelText('Colour picker') as HTMLInputElement).value.toLowerCase()).toBe('#0d0d0d')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Colour' }))
    expect(currentRows()).toEqual([])
  })

  it('creates numeric Capacity, Weight, Max Load, and Power presets with simple units', () => {
    render(<Harness />)
    for (const name of ['Capacity', 'Weight', 'Max Load', 'Power', 'Volume']) {
      openMenu()
      fireEvent.click(screen.getByRole('menuitem', { name }))
    }
    const rows = currentRows()
    expect(rows.map((item) => [item.attribute_name, item.attribute_type, item.unit_of_measure])).toEqual([
      ['Capacity', 'NUMBER', 'ml'],
      ['Weight', 'NUMBER', 'g'],
      ['Max Load', 'NUMBER', 'kg'],
      ['Power', 'NUMBER', 'W'],
      ['Volume', 'NUMBER', 'ml'],
    ])
    expect(Array.from((screen.getByLabelText('Capacity unit') as HTMLSelectElement).options).map((option) => option.value)).toEqual(['ml', 'L'])
    expect(Array.from((screen.getByLabelText('Weight unit') as HTMLSelectElement).options).map((option) => option.value)).toEqual(['g', 'kg'])
    expect(Array.from((screen.getByLabelText('Power unit') as HTMLSelectElement).options).map((option) => option.value)).toEqual(['W', 'kW'])
    expect(Array.from((screen.getByLabelText('Volume unit') as HTMLSelectElement).options).map((option) => option.value)).toEqual(['ml', 'L'])
  })

  it('keeps Material simple and hides all technical type controls', () => {
    render(<Harness />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Material' }))
    expect(screen.getByLabelText('Material value')).not.toBeNull()
    expect(screen.queryByLabelText('Material unit')).toBeNull()
    for (const type of ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'LIST', 'JSON']) expect(screen.queryByText(type)).toBeNull()
    expect(currentRows()[0].attribute_type).toBe('TEXT')
  })

  it('supports a simple Custom Attribute and preserves a hidden existing type', () => {
    render(<Harness initial={[row('Release Date', '2026-01-01', null, 'DATE')]} />)
    expect(screen.getByLabelText('Custom attribute 1 name')).not.toBeNull()
    fireEvent.change(screen.getByLabelText('Custom attribute 1 value'), { target: { value: '2026-02-01' } })
    expect(currentRows()[0].attribute_type).toBe('DATE')
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Custom Attribute' }))
    expect(currentRows()).toHaveLength(2)
  })

  it('does not show required errors until blur or a Save attempt', () => {
    render(<Harness />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Material' }))
    expect(screen.queryByText('Attribute value is required.')).toBeNull()
    fireEvent.blur(screen.getByLabelText('Material value'))
    expect(screen.getByText('Attribute value is required.')).not.toBeNull()

    cleanup()
    render(<Harness initial={[{ ...row('Material', ''), is_draft: true }]} showValidationErrors />)
    expect(screen.getByText('Attribute value is required.')).not.toBeNull()
  })

  it('does not offer an existing preset twice and treats Colour Hex as Colour', () => {
    render(<Harness initial={[row('Capacity', '1', 'L', 'NUMBER'), row('Colour Hex', '#0D0D0D')]} />)
    openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Capacity' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Colour' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Colour Hex' })).toBeNull()
  })
})
