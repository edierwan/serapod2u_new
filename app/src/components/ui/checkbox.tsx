import * as React from "react"
import { Check, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import { cn } from "@/lib/utils"

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
          className={cn(
            "h-4 w-4 appearance-none border border-[var(--sera-line,#e8eaed)] rounded bg-white checked:bg-[var(--sera-orange,#e85d04)] checked:border-[var(--sera-orange,#e85d04)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--sera-orange,#e85d04)]/35 focus:ring-offset-2",
            className
          )}
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
