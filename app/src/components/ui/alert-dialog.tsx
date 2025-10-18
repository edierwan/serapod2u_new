import * as React from "react"

interface AlertDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

const AlertDialog = ({ open = false, onOpenChange, children }: AlertDialogProps) => {
  return (
    <div>
      {React.Children.map(children, (child) =>
        React.cloneElement(child as React.ReactElement, {
          open,
          onOpenChange,
        } as any)
      )}
    </div>
  )
}

interface AlertDialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const AlertDialogContent = React.forwardRef<
  HTMLDivElement,
  AlertDialogContentProps
>(({ open, onOpenChange, className, ...props }, ref) => {
  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={() => onOpenChange?.(false)}
      />
      <div
        ref={ref}
        className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm rounded-lg border border-gray-200 bg-white shadow-lg p-6 ${className}`}
        {...props}
      />
    </>
  )
})
AlertDialogContent.displayName = "AlertDialogContent"

interface AlertDialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

const AlertDialogHeader = React.forwardRef<
  HTMLDivElement,
  AlertDialogHeaderProps
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={`mb-4 ${className}`}
    {...props}
  />
))
AlertDialogHeader.displayName = "AlertDialogHeader"

interface AlertDialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

const AlertDialogTitle = React.forwardRef<
  HTMLHeadingElement,
  AlertDialogTitleProps
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={`text-lg font-semibold ${className}`}
    {...props}
  />
))
AlertDialogTitle.displayName = "AlertDialogTitle"

interface AlertDialogDescriptionProps extends React.HTMLAttributes<HTMLDivElement> {}

const AlertDialogDescription = React.forwardRef<
  HTMLDivElement,
  AlertDialogDescriptionProps
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={`text-sm text-gray-600 ${className}`}
    {...props}
  />
))
AlertDialogDescription.displayName = "AlertDialogDescription"

interface AlertDialogActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onOpenChange?: (open: boolean) => void
}

const AlertDialogAction = React.forwardRef<
  HTMLButtonElement,
  AlertDialogActionProps
>(({ onOpenChange, ...props }, ref) => (
  <button
    ref={ref}
    className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    onClick={(e) => {
      props.onClick?.(e)
      onOpenChange?.(false)
    }}
    {...props}
  />
))
AlertDialogAction.displayName = "AlertDialogAction"

interface AlertDialogCancelProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onOpenChange?: (open: boolean) => void
}

const AlertDialogCancel = React.forwardRef<
  HTMLButtonElement,
  AlertDialogCancelProps
>(({ onOpenChange, ...props }, ref) => (
  <button
    ref={ref}
    className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    onClick={(e) => {
      props.onClick?.(e)
      onOpenChange?.(false)
    }}
    {...props}
  />
))
AlertDialogCancel.displayName = "AlertDialogCancel"

export {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
