import * as React from "react"
import { Check, Minus } from "lucide-react"

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  indeterminate?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate, onCheckedChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onCheckedChange?.(e.target.checked)
    }

    return (
      <div className="relative inline-flex items-center">
        <input
          type="checkbox"
          ref={ref}
          className="h-4 w-4 appearance-none border border-gray-300 rounded bg-white checked:bg-blue-600 checked:border-blue-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          onChange={handleChange}
          {...props}
          checked={!!props.checked}
        />
        {indeterminate ? (
          <Minus className="absolute w-3 h-3 text-white pointer-events-none left-0.5 top-0.5" />
        ) : props.checked ? (
          <Check className="absolute w-3 h-3 text-white pointer-events-none left-0.5 top-0.5" />
        ) : null}
      </div>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
