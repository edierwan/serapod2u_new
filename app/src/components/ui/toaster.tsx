"use client"

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { useToast } from "@/components/ui/use-toast"
import { AlertTriangle, CheckCircle, XCircle, Info } from "lucide-react"

export function Toaster() {
  const { toasts } = useToast()

  const getIcon = (variant?: 'default' | 'destructive' | 'success' | 'warning') => {
    switch (variant) {
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
      case 'destructive':
        return <XCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
      default:
        return <Info className="h-5 w-5 text-blue-600 flex-shrink-0" />
    }
  }

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, open, onOpenChange, variant, ...props }) {
        return (
          <Toast
            key={id}
            variant={variant}
            onOpenChange={onOpenChange}
            open={open}
            {...props}
          >
            <div className="flex items-start gap-3 flex-1">
              {getIcon(variant)}
              <div className="grid gap-1 flex-1">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && (
                  <ToastDescription>{description}</ToastDescription>
                )}
              </div>
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
