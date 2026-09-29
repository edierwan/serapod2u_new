'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export default function OutdoorPasswordField({
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  name,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  disabled?: boolean
  name?: string
}) {
  const [show, setShow] = useState(false)

  return (
    <label className="block text-sm font-medium text-[var(--out-bark)]">
      {label}
      <span className="relative mt-1.5 block">
        <input
          name={name}
          type={show ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="out-input out-input-plain pr-11"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
          onClick={() => setShow((current) => !current)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--out-muted)]"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  )
}
