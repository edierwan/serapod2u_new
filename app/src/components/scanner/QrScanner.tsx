'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { 
  Camera, 
  X, 
  Upload, 
  Flashlight, 
  FlashlightOff,
  SwitchCamera,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Scan
} from 'lucide-react'
import { useQrScanner, ScannerStatus } from '@/hooks/useQrScanner'

interface QrScannerProps {
  onResult: (result: string) => void
  onClose: () => void
  primaryColor?: string
}

export default function QrScanner({ onResult, onClose, primaryColor = '#f97316' }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [detectedCode, setDetectedCode] = useState<string | null>(null)
  const [showInstructions, setShowInstructions] = useState(false)

  const handleResult = useCallback((result: string) => {
    setDetectedCode(result)
    // Auto-navigate after short delay
    setTimeout(() => {
      onResult(result)
    }, 800)
  }, [onResult])

  const {
    status,
    errorMessage,
    cameras,
    selectedCamera,
    torchEnabled,
    torchSupported,
    isInAppBrowser,
    startScanning,
    stopScanning,
    switchCamera,
    toggleTorch,
    scanImage,
    resetStatus,
  } = useQrScanner({
    onResult: handleResult,
    onError: (err) => console.error('Scanner error:', err),
    debounceMs: 2000
  })

  // Start scanning when button is clicked
  const handleStartScan = useCallback(async () => {
    if (!videoRef.current) return
    setIsStarting(true)
    await startScanning(videoRef.current)
    setIsStarting(false)
  }, [startScanning])

  // Handle file upload
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const result = await scanImage(file)
    if (result) {
      handleResult(result)
    }
  }, [scanImage, handleResult])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScanning()
    }
  }, [stopScanning])

  // Get status text
  const getStatusText = () => {
    switch (status) {
      case 'idle':
        return 'Tap Start to scan'
      case 'requesting-permission':
        return 'Requesting camera access...'
      case 'scanning':
        return 'Point at QR code'
      case 'detected':
        return 'QR Code detected!'
      case 'permission-denied':
        return 'Camera permission denied'
      case 'no-camera':
        return 'No camera found'
      case 'not-secure':
        return 'HTTPS required'
      case 'error':
        return 'Camera error'
      default:
        return 'Ready'
    }
  }

  // Get status icon
  const getStatusIcon = () => {
    switch (status) {
      case 'scanning':
        return <Scan className="w-5 h-5 animate-pulse" />
      case 'detected':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />
      case 'requesting-permission':
        return <Loader2 className="w-5 h-5 animate-spin" />
      case 'permission-denied':
      case 'no-camera':
      case 'not-secure':
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      default:
        return <Camera className="w-5 h-5" />
    }
  }

  const isError = ['permission-denied', 'no-camera', 'not-secure', 'error'].includes(status)
  const isScanning = status === 'scanning'
  const isDetected = status === 'detected'

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Hidden element for html5-qrcode */}
      <div id="qr-reader-hidden" style={{ display: 'none' }} />
      
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 safe-area-top">
        <div className="flex items-center justify-between p-4">
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          
          <div className="flex items-center gap-2 bg-black/50 px-4 py-2 rounded-full">
            {getStatusIcon()}
            <span className="text-white text-sm font-medium">{getStatusText()}</span>
          </div>
          
          <div className="w-10" /> {/* Spacer for centering */}
        </div>
      </div>

      {/* In-App Browser Warning */}
      {isInAppBrowser && (
        <div className="absolute top-20 left-4 right-4 z-10 bg-yellow-500/90 text-black p-3 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Camera may not work in this browser</p>
              <p className="mt-1 opacity-80">For best experience, open in Safari or Chrome</p>
            </div>
          </div>
        </div>
      )}

      {/* Video Feed / Scanner Area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Video element */}
        <video
          ref={videoRef}
          className={`absolute inset-0 w-full h-full object-cover ${isScanning || isDetected ? '' : 'hidden'}`}
          playsInline
          muted
          autoPlay
        />

        {/* Idle/Error State */}
        {!isScanning && !isDetected && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 p-6">
            {isError ? (
              <div className="text-center space-y-4 max-w-sm">
                <div className="w-20 h-20 mx-auto rounded-full bg-red-500/20 flex items-center justify-center">
                  <AlertCircle className="w-10 h-10 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-white">
                  {status === 'permission-denied' && 'Camera Access Denied'}
                  {status === 'no-camera' && 'No Camera Found'}
                  {status === 'not-secure' && 'HTTPS Required'}
                  {status === 'error' && 'Camera Error'}
                </h3>
                <p className="text-gray-400 text-sm">{errorMessage}</p>
                
                {status === 'permission-denied' && (
                  <div className="bg-gray-800 rounded-lg p-4 text-left text-sm text-gray-300">
                    <p className="font-medium mb-2">To enable camera:</p>
                    <ol className="list-decimal list-inside space-y-1 text-gray-400">
                      <li>Tap the address bar icon</li>
                      <li>Find &quot;Camera&quot; permission</li>
                      <li>Allow access</li>
                      <li>Refresh and try again</li>
                    </ol>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center space-y-6">
                <div 
                  className="w-28 h-28 mx-auto rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${primaryColor}20` }}
                >
                  <Scan className="w-14 h-14" style={{ color: primaryColor }} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Ready to Scan</h3>
                  <p className="text-gray-400 text-sm mt-2">
                    Tap Start Scan to open your camera
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scan Frame Overlay */}
        {(isScanning || isDetected) && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Semi-transparent overlay with cutout */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-64 h-64">
                {/* Scan frame corners */}
                <div 
                  className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 rounded-tl-lg"
                  style={{ borderColor: isDetected ? '#22c55e' : primaryColor }}
                />
                <div 
                  className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 rounded-tr-lg"
                  style={{ borderColor: isDetected ? '#22c55e' : primaryColor }}
                />
                <div 
                  className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 rounded-bl-lg"
                  style={{ borderColor: isDetected ? '#22c55e' : primaryColor }}
                />
                <div 
                  className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 rounded-br-lg"
                  style={{ borderColor: isDetected ? '#22c55e' : primaryColor }}
                />
                
                {/* Scanning animation line */}
                {isScanning && !isDetected && (
                  <div 
                    className="absolute left-2 right-2 h-0.5 animate-scan"
                    style={{ backgroundColor: primaryColor }}
                  />
                )}
              </div>
            </div>

            {/* Detection success overlay */}
            {isDetected && detectedCode && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <div className="bg-white rounded-2xl p-6 mx-4 text-center max-w-sm animate-scale-in">
                  <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-10 h-10 text-green-500" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900">QR Code Detected!</h3>
                  <p className="text-sm text-gray-500 mt-2 break-all">
                    {detectedCode.length > 100 
                      ? `${detectedCode.substring(0, 100)}...` 
                      : detectedCode
                    }
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-0 left-0 right-0 safe-area-bottom bg-gradient-to-t from-black/80 to-transparent">
        <div className="p-6 space-y-4">
          {/* Camera Controls */}
          {isScanning && (
            <div className="flex justify-center gap-4">
              {/* Switch Camera */}
              {cameras.length > 1 && (
                <button
                  onClick={() => {
                    const currentIndex = cameras.findIndex(c => c.deviceId === selectedCamera)
                    const nextIndex = (currentIndex + 1) % cameras.length
                    switchCamera(cameras[nextIndex].deviceId)
                  }}
                  className="p-3 rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
                >
                  <SwitchCamera className="w-6 h-6" />
                </button>
              )}
              
              {/* Torch Toggle */}
              {torchSupported && (
                <button
                  onClick={toggleTorch}
                  className={`p-3 rounded-full transition-colors ${
                    torchEnabled ? 'bg-yellow-500 text-black' : 'bg-white/20 text-white hover:bg-white/30'
                  }`}
                >
                  {torchEnabled ? <Flashlight className="w-6 h-6" /> : <FlashlightOff className="w-6 h-6" />}
                </button>
              )}
            </div>
          )}

          {/* Main Action Buttons */}
          <div className="flex flex-col gap-3">
            {/* Start/Stop Scan Button */}
            {!isScanning && !isDetected && (
              <button
                onClick={handleStartScan}
                disabled={isStarting || status === 'requesting-permission'}
                className="w-full py-4 rounded-xl font-semibold text-white text-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                style={{ backgroundColor: primaryColor }}
              >
                {isStarting || status === 'requesting-permission' ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Opening Camera...
                  </>
                ) : (
                  <>
                    <Camera className="w-5 h-5" />
                    Start Scan
                  </>
                )}
              </button>
            )}

            {isScanning && (
              <button
                onClick={stopScanning}
                className="w-full py-4 rounded-xl font-semibold text-white text-lg bg-gray-700 hover:bg-gray-600 transition-colors"
              >
                Stop Scanning
              </button>
            )}

            {/* Upload Image Fallback */}
            {!isDetected && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 rounded-xl font-medium text-white bg-white/20 hover:bg-white/30 transition-colors flex items-center justify-center gap-2"
              >
                <Upload className="w-5 h-5" />
                Upload QR Image
              </button>
            )}
            
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Help Text */}
          {isScanning && (
            <p className="text-center text-white/70 text-sm">
              Position QR code within the frame
            </p>
          )}
        </div>
      </div>

      {/* Global CSS for animations - injected once */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes qr-scan-line {
          0%, 100% { top: 8px; }
          50% { top: calc(100% - 10px); }
        }
        .animate-scan { animation: qr-scan-line 2s ease-in-out infinite; }
        @keyframes qr-scale-in {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-scale-in { animation: qr-scale-in 0.3s ease-out; }
        .safe-area-top { padding-top: env(safe-area-inset-top, 0px); }
        .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom, 0px); }
      ` }} />
    </div>
  )
}
