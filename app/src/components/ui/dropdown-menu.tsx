import * as React from "react"

interface DropdownMenuProps {
  children: React.ReactNode
}

const DropdownMenu = ({ children }: DropdownMenuProps) => {
  const [isOpen, setIsOpen] = React.useState(false)
  return (
    <div className="relative">
      {React.Children.map(children, (child) =>
        React.cloneElement(child as React.ReactElement, {
          isOpen,
          setIsOpen,
        } as any)
      )}
    </div>
  )
}

interface DropdownMenuTriggerProps extends React.HTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
  isOpen?: boolean
  setIsOpen?: (open: boolean) => void
}

const DropdownMenuTrigger = React.forwardRef<
  HTMLButtonElement,
  DropdownMenuTriggerProps
>(({ children, asChild, isOpen, setIsOpen, ...props }, ref) => {
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, {
      onClick: () => setIsOpen?.(!isOpen),
      ref,
    } as any)
  }

  return (
    <button
      ref={ref}
      onClick={() => setIsOpen?.(!isOpen)}
      {...props}
    >
      {children}
    </button>
  )
})
DropdownMenuTrigger.displayName = "DropdownMenuTrigger"

interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end"
  isOpen?: boolean
  setIsOpen?: (open: boolean) => void
}

const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  DropdownMenuContentProps
>(({ align = "start", isOpen, setIsOpen, className, ...props }, ref) => {
  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 z-30"
        onClick={() => setIsOpen?.(false)}
      />
      <div
        ref={ref}
        className={`absolute top-full mt-1 z-40 min-w-[160px] rounded-md border border-gray-200 bg-white shadow-md ${
          align === "end" ? "right-0" : "left-0"
        } ${className}`}
        {...props}
      />
    </>
  )
})
DropdownMenuContent.displayName = "DropdownMenuContent"

interface DropdownMenuItemProps extends React.HTMLAttributes<HTMLDivElement> {}

const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuItemProps
>(({ ...props }, ref) => (
  <div
    ref={ref}
    className="px-2 py-2 text-sm cursor-pointer hover:bg-gray-100 rounded"
    {...props}
  />
))
DropdownMenuItem.displayName = "DropdownMenuItem"

interface DropdownMenuSeparatorProps extends React.HTMLAttributes<HTMLDivElement> {}

const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  DropdownMenuSeparatorProps
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={`h-px bg-gray-200 my-1 ${className}`}
    {...props}
  />
))
DropdownMenuSeparator.displayName = "DropdownMenuSeparator"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
}
