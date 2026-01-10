'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

export type ScannerStatus =
    | 'idle'
    | 'requesting-permission'
    | 'scanning'
    | 'detected'
    | 'permission-denied'
    | 'no-camera'
    | 'not-secure'
    | 'error'

export interface QrScannerOptions {
    onResult?: (result: string) => void
    onError?: (error: string) => void
    debounceMs?: number
}

interface CameraDevice {
    deviceId: string
    label: string
}

export function useQrScanner(options: QrScannerOptions = {}) {
    const { onResult, onError, debounceMs = 2000 } = options

    const [status, setStatus] = useState<ScannerStatus>('idle')
    const [errorMessage, setErrorMessage] = useState<string>('')
    const [cameras, setCameras] = useState<CameraDevice[]>([])
    const [selectedCamera, setSelectedCamera] = useState<string>('')
    const [torchEnabled, setTorchEnabled] = useState(false)
    const [torchSupported, setTorchSupported] = useState(false)

    const streamRef = useRef<MediaStream | null>(null)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const scannerRef = useRef<any>(null)
    const lastDetectedRef = useRef<string>('')
    const lastDetectionTimeRef = useRef<number>(0)
    const isUnmountedRef = useRef(false)

    // Detect if running in in-app browser
    const detectInAppBrowser = useCallback(() => {
        const ua = navigator.userAgent || navigator.vendor || (window as any).opera
        const isInApp = /FBAN|FBAV|Instagram|TikTok|Line|Snapchat|Twitter/i.test(ua)
        return isInApp
    }, [])

    // Check if context is secure (HTTPS)
    const isSecureContext = useCallback(() => {
        return window.isSecureContext || window.location.protocol === 'https:' ||
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1'
    }, [])

    // Enumerate available cameras
    const enumerateCameras = useCallback(async () => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices()
            const videoDevices = devices
                .filter(device => device.kind === 'videoinput')
                .map(device => ({
                    deviceId: device.deviceId,
                    label: device.label || `Camera ${device.deviceId.slice(0, 5)}`
                }))

            setCameras(videoDevices)

            // Try to select rear camera by default
            const rearCamera = videoDevices.find(
                cam => cam.label.toLowerCase().includes('back') ||
                    cam.label.toLowerCase().includes('rear') ||
                    cam.label.toLowerCase().includes('environment')
            )

            if (rearCamera) {
                setSelectedCamera(rearCamera.deviceId)
            } else if (videoDevices.length > 0) {
                setSelectedCamera(videoDevices[0].deviceId)
            }

            return videoDevices
        } catch (error) {
            console.error('Error enumerating cameras:', error)
            return []
        }
    }, [])

    // Stop the media stream
    const stopStream = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop())
            streamRef.current = null
        }
        if (scannerRef.current) {
            try {
                scannerRef.current.stop()
            } catch (e) {
                // Ignore errors when stopping
            }
            scannerRef.current = null
        }
    }, [])

    // Start scanning
    const startScanning = useCallback(async (videoElement: HTMLVideoElement) => {
        if (isUnmountedRef.current) return

        // Check secure context first
        if (!isSecureContext()) {
            setStatus('not-secure')
            setErrorMessage('Camera requires HTTPS. Please access this site via HTTPS.')
            onError?.('Camera requires HTTPS connection')
            return
        }

        // Check if already scanning
        if (status === 'scanning') {
            return
        }

        setStatus('requesting-permission')
        setErrorMessage('')
        videoRef.current = videoElement

        try {
            // Request camera permission
            const constraints: MediaStreamConstraints = {
                video: selectedCamera
                    ? { deviceId: { exact: selectedCamera } }
                    : { facingMode: 'environment' }
            }

            const stream = await navigator.mediaDevices.getUserMedia(constraints)

            if (isUnmountedRef.current) {
                stream.getTracks().forEach(track => track.stop())
                return
            }

            streamRef.current = stream
            videoElement.srcObject = stream

            // Check torch support
            const videoTrack = stream.getVideoTracks()[0]
            if (videoTrack) {
                const capabilities = videoTrack.getCapabilities?.() as any
                setTorchSupported(capabilities?.torch === true)
            }

            // Enumerate cameras after permission is granted
            await enumerateCameras()

            // Wait for video to be ready
            await new Promise<void>((resolve) => {
                videoElement.onloadedmetadata = () => {
                    videoElement.play().then(() => resolve()).catch(() => resolve())
                }
            })

            if (isUnmountedRef.current) {
                stopStream()
                return
            }

            setStatus('scanning')

            // Start QR decoding using html5-qrcode
            const { Html5Qrcode } = await import('html5-qrcode')

            // Create scanner instance for decoding
            const html5QrCode = new Html5Qrcode('qr-reader-hidden')
            scannerRef.current = html5QrCode

            // Use camera for scanning
            await html5QrCode.start(
                selectedCamera || { facingMode: 'environment' },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    aspectRatio: 1.0,
                },
                (decodedText) => {
                    if (isUnmountedRef.current) return

                    const now = Date.now()
                    // Debounce duplicate scans
                    if (decodedText === lastDetectedRef.current &&
                        now - lastDetectionTimeRef.current < debounceMs) {
                        return
                    }

                    lastDetectedRef.current = decodedText
                    lastDetectionTimeRef.current = now

                    setStatus('detected')
                    onResult?.(decodedText)
                },
                () => {
                    // QR code not found in frame - normal during scanning
                }
            )

        } catch (error: any) {
            if (isUnmountedRef.current) return

            console.error('Camera error:', error)

            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                setStatus('permission-denied')
                setErrorMessage('Camera permission denied. Please enable camera access in your browser settings.')
                onError?.('Camera permission denied')
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                setStatus('no-camera')
                setErrorMessage('No camera found on this device.')
                onError?.('No camera found')
            } else {
                setStatus('error')
                setErrorMessage(error.message || 'Failed to start camera')
                onError?.(error.message || 'Failed to start camera')
            }
        }
    }, [selectedCamera, isSecureContext, enumerateCameras, debounceMs, onResult, onError, status, stopStream])

    // Stop scanning but keep stream alive
    const pauseScanning = useCallback(() => {
        if (scannerRef.current) {
            try {
                scannerRef.current.pause()
            } catch (e) {
                // Ignore
            }
        }
        if (status === 'scanning') {
            setStatus('idle')
        }
    }, [status])

    // Resume scanning
    const resumeScanning = useCallback(() => {
        if (scannerRef.current && streamRef.current) {
            try {
                scannerRef.current.resume()
                setStatus('scanning')
            } catch (e) {
                // Need to restart
                if (videoRef.current) {
                    startScanning(videoRef.current)
                }
            }
        }
    }, [startScanning])

    // Switch camera
    const switchCamera = useCallback(async (deviceId: string) => {
        setSelectedCamera(deviceId)
        stopStream()

        if (videoRef.current) {
            // Small delay to ensure cleanup
            setTimeout(() => {
                if (videoRef.current) {
                    startScanning(videoRef.current)
                }
            }, 100)
        }
    }, [stopStream, startScanning])

    // Toggle torch
    const toggleTorch = useCallback(async () => {
        if (!streamRef.current || !torchSupported) return

        const videoTrack = streamRef.current.getVideoTracks()[0]
        if (videoTrack) {
            try {
                await (videoTrack as any).applyConstraints({
                    advanced: [{ torch: !torchEnabled }]
                })
                setTorchEnabled(!torchEnabled)
            } catch (error) {
                console.error('Failed to toggle torch:', error)
            }
        }
    }, [torchEnabled, torchSupported])

    // Scan image file
    const scanImage = useCallback(async (file: File): Promise<string | null> => {
        try {
            const { Html5Qrcode } = await import('html5-qrcode')
            const html5QrCode = new Html5Qrcode('qr-reader-hidden')

            const result = await html5QrCode.scanFile(file, true)
            html5QrCode.clear()

            onResult?.(result)
            return result
        } catch (error: any) {
            console.error('Image scan error:', error)
            onError?.('Could not detect QR code in image. Try a clearer image.')
            return null
        }
    }, [onResult, onError])

    // Cleanup on unmount
    useEffect(() => {
        isUnmountedRef.current = false

        return () => {
            isUnmountedRef.current = true
            stopStream()
        }
    }, [stopStream])

    // Reset status to idle after detection
    const resetStatus = useCallback(() => {
        if (status === 'detected') {
            setStatus('scanning')
        }
    }, [status])

    return {
        status,
        errorMessage,
        cameras,
        selectedCamera,
        torchEnabled,
        torchSupported,
        isInAppBrowser: detectInAppBrowser(),
        startScanning,
        stopScanning: stopStream,
        pauseScanning,
        resumeScanning,
        switchCamera,
        toggleTorch,
        scanImage,
        resetStatus,
    }
}
