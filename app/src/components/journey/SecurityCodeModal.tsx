"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Shield, AlertCircle, Keyboard, Hash } from "lucide-react"

interface SecurityCodeModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  publicToken: string
}

export function SecurityCodeModal({
  isOpen,
  onClose,
  onSuccess,
  publicToken,
}: SecurityCodeModalProps) {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  // Keyboard mode: 'numeric' for digit-only, 'alphanumeric' for letters + numbers
  const [keyboardMode, setKeyboardMode] = useState<'numeric' | 'alphanumeric'>('alphanumeric')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (code.length !== 2) {
      setError("Please enter a 2-character code")
      return
    }

    setLoading(true)
    setError("")

    try {
      const response = await fetch("/api/qr/verify-security-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          publicToken,
          code: code.toUpperCase(), // Normalize to uppercase for comparison
        }),
      })

      const data = await response.json()

      if (data.ok) {
        onSuccess()
        onClose()
        setCode("")
      } else {
        setError(data.error || "Invalid security code. Please check the 2 characters on your product box.")
      }
    } catch (err) {
      setError("Failed to verify code. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setCode("")
    setError("")
    onClose()
  }

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value
    
    if (keyboardMode === 'numeric') {
      // Only allow digits
      val = val.replace(/[^0-9]/g, '')
    } else {
      // Allow alphanumeric, convert to uppercase
      val = val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    }
    
    setCode(val)
    setError("")
  }

  const toggleKeyboardMode = () => {
    setKeyboardMode(prev => prev === 'numeric' ? 'alphanumeric' : 'numeric')
    setCode("") // Clear code when switching modes
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-orange-600" />
            Security Verification
          </DialogTitle>
          <DialogDescription>
            Please enter the 2-digit security code printed on your product box to continue.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="security-code">Security Code</Label>
              <Input
                id="security-code"
                type={keyboardMode === 'numeric' ? 'tel' : 'text'}
                inputMode={keyboardMode === 'numeric' ? 'numeric' : 'text'}
                autoComplete="off"
                pattern={keyboardMode === 'numeric' ? '[0-9]*' : '[A-Za-z0-9]*'}
                maxLength={2}
                placeholder={keyboardMode === 'numeric' ? 'Enter 2 digits' : 'Enter 2 characters'}
                value={code}
                onChange={handleCodeChange}
                className="text-center text-2xl font-mono tracking-widest uppercase"
                autoFocus
                disabled={loading}
              />
              <p className="text-xs text-gray-500 text-center">
                The code can contain letters and numbers (e.g., A7, 3B, XY)
              </p>
            </div>

            {/* Keyboard Mode Toggle */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={toggleKeyboardMode}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                {keyboardMode === 'numeric' ? (
                  <>
                    <Keyboard className="w-4 h-4" />
                    <span>Switch to letters & numbers</span>
                  </>
                ) : (
                  <>
                    <Hash className="w-4 h-4" />
                    <span>Switch to numbers only</span>
                  </>
                )}
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-blue-800">
                💡 The security code is printed on your product box. It's the last 2 characters from the QR code.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || code.length !== 2}>
              {loading ? "Verifying..." : "Verify"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
