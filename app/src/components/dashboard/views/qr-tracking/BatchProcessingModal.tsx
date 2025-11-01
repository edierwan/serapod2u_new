import { useEffect, useState } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { CheckCircle, XCircle, Copy, AlertCircle } from 'lucide-react'

interface BatchProcessingModalProps {
  open: boolean
  total: number
  successCount: number
  duplicateCount: number
  errorCount: number
  currentIndex: number
  currentCode?: string
}

export default function BatchProcessingModal({
  open,
  total,
  successCount,
  duplicateCount,
  errorCount,
  currentIndex,
  currentCode
}: BatchProcessingModalProps) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (total > 0) {
      setProgress((currentIndex / total) * 100)
    }
  }, [currentIndex, total])

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-2xl" onPointerDownOutside={e => e.preventDefault()}>
        <div className="space-y-6 py-4">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold">Processing Batch</h2>
            <p className="text-xl text-muted-foreground">
              Scanning code {currentIndex} of {total}
            </p>
            <p className="text-sm text-muted-foreground uppercase font-medium tracking-wide">
              {currentIndex} OF {total} CODES SCANNED
            </p>
          </div>

          <div className="space-y-2">
            <Progress value={progress} className="h-3" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-6 text-center space-y-2">
              <div className="flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-sm font-medium text-emerald-700 uppercase tracking-wide">Success</p>
              <p className="text-4xl font-bold text-emerald-700">{successCount}</p>
            </div>

            <div className="rounded-lg bg-amber-50 border border-amber-200 p-6 text-center space-y-2">
              <div className="flex items-center justify-center">
                <Copy className="h-6 w-6 text-amber-600" />
              </div>
              <p className="text-sm font-medium text-amber-700 uppercase tracking-wide">Duplicates</p>
              <p className="text-4xl font-bold text-amber-700">{duplicateCount}</p>
            </div>

            <div className="rounded-lg bg-rose-50 border border-rose-200 p-6 text-center space-y-2">
              <div className="flex items-center justify-center">
                <XCircle className="h-6 w-6 text-rose-600" />
              </div>
              <p className="text-sm font-medium text-rose-700 uppercase tracking-wide">Errors</p>
              <p className="text-4xl font-bold text-rose-700">{errorCount}</p>
            </div>
          </div>

          {currentCode && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-blue-900 uppercase tracking-wide mb-1">Currently processing</p>
                  <p className="text-sm font-mono text-blue-700 break-all">{currentCode}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
