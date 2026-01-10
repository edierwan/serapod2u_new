'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import {
    Camera,
    X,
    Upload,
    AlertCircle,
    CheckCircle2,
    Loader2,
    Scan
} from 'lucide-react'

type ScannerStatus = 'idle' | 'requesting-permission' | 'scanning' | 'detected' | 'permission-denied' | 'no-camera' | 'error'

interface QrScannerProps {
    onResult: (result: string) => void
    onClose: () => void
    primaryColor?: string
}

export default function QrScanner({ onResult, onClose, primaryColor = '#f97316' }: QrScannerProps) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const scannerRef = useRef<any>(null)
    const [status, setStatus] = useState<ScannerStatus>('idle')
    const [errorMessage, setErrorMessage] = useState('')
    const [detectedCode, setDetectedCode] = useState<string | null>(null)
    const [isStarting, setIsStarting] = useState(false)
    const lastDetectedRef = useRef<string>('')
    const lastDetectionTimeRef = useRef<number>(0)

    // Detect in-app browser
    const isInAppBrowser = typeof navigator !== 'undefined' &&
        /FBAN|FBAV|Instagram|TikTok|Line|Snapchat|Twitter/i.test(navigator.userAgent)

    // Handle QR code detection
    const handleDetection = useCallback((decodedText: string) => {
        const now = Date.now()
        // Debounce - ignore same code within 2 seconds
        if (decodedText === lastDetectedRef.current && now - lastDetectionTimeRef.current < 2000) {
            return
        }

        lastDetectedRef.current = decodedText
        lastDetectionTimeRef.current = now
        setDetectedCode(decodedText)
        setStatus('detected')

        // Stop scanner
        if (scannerRef.current) {
            try {
                scannerRef.current.stop().catch(() => { })
            } catch (e) { }
        }

        // Navigate after short delay
        setTimeout(() => {
            onResult(decodedText)
        }, 800)
    }, [onResult])

    // Start scanning
    const startScanning = useCallback(async () => {
        if (isStarting || status === 'scanning') return

        setIsStarting(true)
        setStatus('requesting-permission')
        setErrorMessage('')

        try {
            const { Html5Qrcode } = await import('html5-qrcode')

            // Clean up existing scanner
            if (scannerRef.current) {
                try {
                    await scannerRef.current.stop()
                } catch (e) { }
                scannerRef.current = null
            }

            const scanner = new Html5Qrcode('qr-reader-container')
            scannerRef.current = scanner

            await scanner.start(
                { facingMode: 'environment' },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                },
                (decodedText) => {
                    handleDetection(decodedText)
                },
                () => {
                    // QR code not found in frame - this is normal
                }
            )

            setStatus('scanning')
        } catch (error: any) {
            console.error('Scanner error:', error)

            if (error.name === 'NotAllowedError' || error.message?.includes('Permission')) {
                setStatus('permission-denied')
                setErrorMessage('Camera permission denied. Please enable camera access in your browser settings.')
            } else if (error.name === 'NotFoundError' || error.message?.includes('No camera')) {
                setStatus('no-camera')
                setErrorMessage('No camera found on this device.')
            } else {
                setStatus('error')
                setErrorMessage(error.message || 'Failed to start camera')
            }
        } finally {
            setIsStarting(false)
        }
    }, [isStarting, status, handleDetection])

    // Stop scanning
    const stopScanning = useCallback(async () => {
        if (scannerRef.current) {
            try {
                await scannerRef.current.stop()
            } catch (e) { }
            scannerRef.current = null
        }
        setStatus('idle')
    }, [])

    // Handle file upload
    const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        try {
            const { Html5Qrcode } = await import('html5-qrcode')
            const scanner = new Html5Qrcode('qr-file-scanner')

            const result = await scanner.scanFile(file, true)
            scanner.clear()

            handleDetection(result)
        } catch (error: any) {
            console.error('Image scan error:', error)
            setErrorMessage('Could not detect QR code in image. Try a clearer image.')
        }
    }, [handleDetection])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (scannerRef.current) {
                try {
                    scannerRef.current.stop().catch(() => { })
                } catch (e) { }
            }
        }
    }, [])

    // Get status text
    const getStatusText = () => {
        switch (status) {
            case 'idle': return 'Tap Start to scan'
            case 'requesting-permission': return 'Requesting camera access...'
            case 'scanning': return 'Point at QR code'
            case 'detected': return 'QR Code detected!'
            case 'permission-denied': return 'Camera permission denied'
            case 'no-camera': return 'No camera found'
            case 'error': return 'Camera error'
            default: return 'Ready'
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
            case 'error':
                return <AlertCircle className="w-5 h-5 text-red-500" />
            default:
                return <Camera className="w-5 h-5" />
        }
    }

    const isError = ['permission-denied', 'no-camera', 'error'].includes(status)
    const isScanning = status === 'scanning'
    const isDetected = status === 'detected'

    return (
        <div className="fixed inset-0 bg-black z-[9999] flex flex-col">
            {/* Hidden elements for html5-qrcode file scanning */}
            <div id="qr-file-scanner" style={{ display: 'none' }} />

            {/* Header */}
            <div className="absolute top-0 left-0 right-0 z-10" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
                <div className="flex items-center justify-between p-4">
                    <button
                        onClick={() => {
                            stopScanning()
                            onClose()
                        }}
                        className="p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>

                    <div className="flex items-center gap-2 bg-black/50 px-4 py-2 rounded-full">
                        {getStatusIcon()}
                        <span className="text-white text-sm font-medium">{getStatusText()}</span>
                    </div>

                    <div className="w-10" />
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

            {/* Main Content */}
            <div className="flex-1 relative overflow-hidden">
                {/* Scanner Container - html5-qrcode renders video here */}
                <div
                    id="qr-reader-container"
                    className={`absolute inset-0 ${isScanning || isDetected ? '' : 'hidden'}`}
                    style={{
                        width: '100%',
                        height: '100%',
                    }}
                />

                {/* Custom overlay when scanning */}
                {(isScanning || isDetected) && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
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
                        </div>
                    </div>
                )}

                {/* Detection success overlay */}
                {isDetected && detectedCode && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20">
                        <div className="bg-white rounded-2xl p-6 mx-4 text-center max-w-sm">
                            <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-4">
                                <CheckCircle2 className="w-10 h-10 text-green-500" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900">QR Code Detected!</h3>
                            <p className="text-sm text-gray-500 mt-2 break-all">
                                {detectedCode.length > 100 ? `${detectedCode.substring(0, 100)}...` : detectedCode}
                            </p>
                            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-400">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Processing...
                            </div>
                        </div>
                    </div>
                )}

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
            </div>

            {/* Bottom Controls */}
            <div
                className="bg-gradient-to-t from-black/80 to-transparent p-6 space-y-4"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)' }}
            >
                {/* Main Action Buttons */}
                <div className="flex flex-col gap-3">
                    {/* Start Scan Button */}
                    {!isScanning && !isDetected && (
                        <button
                            onClick={startScanning}
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

                    {/* Stop Button */}
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

            {/* Override html5-qrcode default styles */}
            <style dangerouslySetInnerHTML={{
                __html: `
        #qr-reader-container video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
        #qr-reader-container {
          border: none !important;
        }
        #qr-reader-container > div {
          display: none !important;
        }
        #qr-reader-container > video {
          display: block !important;
        }
        #qr-shaded-region {
          display: none !important;
        }
      ` }} />
        </div>
    )
}
