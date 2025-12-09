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
import { Shield, AlertCircle } from "lucide-react"

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
          code,
        }),
      })

      const data = await response.json()

      if (data.ok) {
        onSuccess()
        onClose()
        setCode("")
      } else {
        setError(data.error || "Invalid security code. Please check the 2 digits on your product box.")
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

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-orange-600" />
            Security Verification
          </DialogTitle>
          <DialogDescription>
            Please enter the 2-character security code printed on your product box to continue.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="security-code">Security Code</Label>
              <Input
                id="security-code"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                pattern="[0-9a-zA-Z]{2}"
                maxLength={2}
                placeholder="Enter 2-character code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase())
                  setError("")
                }}
                className="text-center text-2xl font-mono tracking-widest uppercase"
                autoFocus
                disabled={loading}
              />
              <p className="text-xs text-gray-500 text-center">
                The code can contain letters and numbers (e.g., A7, 3B, XY)
              </p>
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
