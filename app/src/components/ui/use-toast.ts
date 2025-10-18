'use client'

import * as React from 'react'

export interface Toast {
  id?: string
  title?: React.ReactNode
  description?: React.ReactNode
  open?: boolean
  action?: React.ReactNode
  onOpenChange?: (open: boolean) => void
  variant?: 'default' | 'destructive' | 'success'
}

const TOAST_REMOVE_DELAY = 4000

const listeners: Array<(toast: Toast[]) => void> = []

let toasts: Toast[] = []

function toast(props: Omit<Toast, 'id'> | Toast) {
  const id = Math.random().toString(36).substr(2, 9)

  const update = (props: Toast) =>
    toasts.map((t) => (t.id === id ? { ...t, ...props } : t))

  const dismiss = () => {
    toasts = toasts.filter((t) => t.id !== id)
    listeners.forEach((listener) => listener(toasts))
  }

  toasts = [{ ...props, id, open: true }, ...toasts]
  listeners.forEach((listener) => listener(toasts))

  setTimeout(() => {
    dismiss()
  }, TOAST_REMOVE_DELAY)

  return {
    id,
    dismiss,
    update: (props: Toast) => {
      toasts = update(props)
      listeners.forEach((listener) => listener(toasts))
    }
  }
}

export { toast }

export function useToast() {
  const [state, setState] = React.useState<Toast[]>([])

  React.useEffect(() => {
    listeners.push(setState)
    setState(toasts)

    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [state])

  return {
    toasts: state,
    toast,
    dismiss: (toastId?: string) => {
      if (toastId) {
        toasts = toasts.filter((t) => t.id !== toastId)
      } else {
        toasts = []
      }
      listeners.forEach((listener) => listener(toasts))
    }
  }
}
