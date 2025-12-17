/**
 * PDF Optimization Utilities
 * 
 * Provides image compression and PDF size optimization
 * Target: 60-90% file size reduction while preserving:
 * - Text sharpness and scannability
 * - Original page size (A4/Letter)
 * - Layout, margins, and fonts
 * - Printable quality at 100% zoom
 */

import { PNG } from 'pngjs'

// Compression quality settings for "ebook-grade" balance
// Optimized for ~200-300KB target while maintaining readability
export const PDF_OPTIMIZATION_CONFIG = {
  // Logo compression settings - preserve quality for branding
  logo: {
    maxWidth: 300,        // Reduced from 400 - still clear at 40mm width
    maxHeight: 100,       // Proportional to width
    quality: 0.75,        // Slightly lower quality for smaller file
    useJpeg: false,       // Keep PNG for logos with transparency
    preserveColors: true, // Don't reduce colors for logo
  },
  // Signature compression settings  
  signature: {
    maxWidth: 200,        // Reduced from 300 - signatures don't need high res
    maxHeight: 70,        // Reduced from 100
    quality: 0.5,         // More aggressive compression for signatures
    colors: 8,            // Reduced from 16 - signatures are simple drawings
  },
  // General image settings
  images: {
    defaultQuality: 0.6,  // Reduced from 0.7
    maxDimension: 600,    // Reduced from 800 - adequate for A4 PDF
  }
}

export interface CompressionResult {
  data: string          // Base64 data URL
  originalSize: number  // Original size in bytes
  compressedSize: number // Compressed size in bytes
  reduction: number     // Percentage reduction
  format: 'png' | 'jpeg'
}

export interface PDFSizeStats {
  originalSize: number
  compressedSize: number
  reduction: number
  reductionPercent: string
  logoSize?: number
  signatureSize?: number
}

/**
 * Compress a PNG image by reducing color depth and removing unnecessary data
 * Server-side implementation using pngjs
 */
export async function compressPngServer(
  base64Data: string,
  options: {
    maxWidth?: number
    maxHeight?: number
    reduceColors?: boolean
    colorDepth?: number
  } = {}
): Promise<CompressionResult> {
  const { 
    maxWidth = 400, 
    maxHeight = 200,
    reduceColors = true,
    colorDepth = 64  // Reduce to fewer colors for smaller file
  } = options

  // Extract base64 content
  const base64Content = base64Data.includes('base64,')
    ? base64Data.substring(base64Data.indexOf('base64,') + 7)
    : base64Data.replace(/^data:image\/[a-zA-Z+]+;base64,/, '')

  const originalBuffer = Buffer.from(base64Content, 'base64')
  const originalSize = originalBuffer.length

  try {
    // Parse PNG
    const png = PNG.sync.read(originalBuffer)
    
    // Calculate new dimensions while maintaining aspect ratio
    let newWidth = png.width
    let newHeight = png.height
    
    if (newWidth > maxWidth || newHeight > maxHeight) {
      const widthRatio = maxWidth / newWidth
      const heightRatio = maxHeight / newHeight
      const ratio = Math.min(widthRatio, heightRatio)
      newWidth = Math.floor(newWidth * ratio)
      newHeight = Math.floor(newHeight * ratio)
    }

    // Create new PNG with potentially smaller dimensions
    const resizedPng = new PNG({ width: newWidth, height: newHeight })
    
    // Bilinear interpolation for better quality resizing (important for logos)
    for (let y = 0; y < newHeight; y++) {
      for (let x = 0; x < newWidth; x++) {
        const srcX = x * (png.width - 1) / (newWidth - 1 || 1)
        const srcY = y * (png.height - 1) / (newHeight - 1 || 1)
        
        const x0 = Math.floor(srcX)
        const y0 = Math.floor(srcY)
        const x1 = Math.min(x0 + 1, png.width - 1)
        const y1 = Math.min(y0 + 1, png.height - 1)
        
        const xWeight = srcX - x0
        const yWeight = srcY - y0
        
        const dstIdx = (newWidth * y + x) << 2
        
        // Bilinear interpolation for each channel
        for (let c = 0; c < 4; c++) {
          const idx00 = ((png.width * y0 + x0) << 2) + c
          const idx10 = ((png.width * y0 + x1) << 2) + c
          const idx01 = ((png.width * y1 + x0) << 2) + c
          const idx11 = ((png.width * y1 + x1) << 2) + c
          
          const top = png.data[idx00] * (1 - xWeight) + png.data[idx10] * xWeight
          const bottom = png.data[idx01] * (1 - xWeight) + png.data[idx11] * xWeight
          resizedPng.data[dstIdx + c] = Math.round(top * (1 - yWeight) + bottom * yWeight)
        }
      }
    }

    // Reduce colors if enabled (quantization) - NOT for logos
    if (reduceColors && colorDepth < 256) {
      const step = Math.ceil(256 / colorDepth)
      for (let i = 0; i < resizedPng.data.length; i += 4) {
        // Quantize RGB values
        resizedPng.data[i] = Math.round(resizedPng.data[i] / step) * step
        resizedPng.data[i + 1] = Math.round(resizedPng.data[i + 1] / step) * step
        resizedPng.data[i + 2] = Math.round(resizedPng.data[i + 2] / step) * step
        // Keep alpha as-is
      }
    }

    // Write compressed PNG with maximum compression
    const compressedBuffer = PNG.sync.write(resizedPng, {
      filterType: 4,  // Paeth filter - best for photos/gradients
      deflateLevel: 9, // Maximum compression
      deflateStrategy: 1, // Filtered strategy
    })

    const compressedSize = compressedBuffer.length
    const reduction = ((originalSize - compressedSize) / originalSize) * 100

    return {
      data: `data:image/png;base64,${compressedBuffer.toString('base64')}`,
      originalSize,
      compressedSize,
      reduction: Math.max(0, reduction),
      format: 'png'
    }
  } catch (error) {
    console.warn('PNG compression failed, returning original:', error)
    return {
      data: base64Data.startsWith('data:') ? base64Data : `data:image/png;base64,${base64Content}`,
      originalSize,
      compressedSize: originalSize,
      reduction: 0,
      format: 'png'
    }
  }
}

/**
 * Compress logo image for PDF embedding
 * Logo needs to preserve full quality and colors for branding
 */
export async function compressLogoForPdf(base64Data: string): Promise<CompressionResult> {
  return compressPngServer(base64Data, {
    maxWidth: PDF_OPTIMIZATION_CONFIG.logo.maxWidth,
    maxHeight: PDF_OPTIMIZATION_CONFIG.logo.maxHeight,
    reduceColors: false,  // Don't reduce colors for logo - preserve branding quality
    colorDepth: 256       // Full color depth
  })
}

/**
 * Compress signature image for PDF embedding
 * Signatures can be more aggressively compressed since they're typically
 * simple line drawings with few colors
 */
export async function compressSignatureForPdf(base64Data: string): Promise<CompressionResult> {
  return compressPngServer(base64Data, {
    maxWidth: PDF_OPTIMIZATION_CONFIG.signature.maxWidth,
    maxHeight: PDF_OPTIMIZATION_CONFIG.signature.maxHeight,
    reduceColors: true,
    colorDepth: PDF_OPTIMIZATION_CONFIG.signature.colors  // Few colors needed for signatures
  })
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * Calculate PDF size statistics for notification
 */
export function calculatePdfStats(
  originalEstimate: number,
  actualSize: number,
  logoCompressionResult?: CompressionResult,
  signatureCompressionResults?: CompressionResult[]
): PDFSizeStats {
  const reduction = originalEstimate - actualSize
  const reductionPercent = originalEstimate > 0 
    ? ((reduction / originalEstimate) * 100).toFixed(1)
    : '0'

  return {
    originalSize: originalEstimate,
    compressedSize: actualSize,
    reduction,
    reductionPercent: `${reductionPercent}%`,
    logoSize: logoCompressionResult?.compressedSize,
    signatureSize: signatureCompressionResults?.reduce((sum, r) => sum + r.compressedSize, 0)
  }
}

/**
 * Generate size summary message for user notification
 */
export function generateSizeSummary(stats: PDFSizeStats): string {
  const lines: string[] = []
  
  lines.push(`📄 PDF Size: ${formatFileSize(stats.compressedSize)}`)
  
  if (stats.reduction > 0) {
    lines.push(`💾 Saved: ${formatFileSize(stats.reduction)} (${stats.reductionPercent} reduction)`)
  }
  
  if (stats.logoSize) {
    lines.push(`🖼️ Logo: ${formatFileSize(stats.logoSize)}`)
  }
  
  if (stats.signatureSize) {
    lines.push(`✍️ Signatures: ${formatFileSize(stats.signatureSize)}`)
  }

  return lines.join('\n')
}

/**
 * Estimate uncompressed PDF size based on content
 * Used for calculating reduction percentage
 */
export function estimateUncompressedSize(options: {
  logoSize?: number
  signatureCount?: number
  averageSignatureSize?: number
  pageCount?: number
  hasTable?: boolean
}): number {
  const {
    logoSize = 50000,  // ~50KB typical uncompressed logo
    signatureCount = 0,
    averageSignatureSize = 100000,  // ~100KB per uncompressed signature
    pageCount = 1,
    hasTable = true
  } = options

  // Base PDF overhead (fonts, structure, etc.)
  let estimate = 20000

  // Logo contribution
  estimate += logoSize

  // Signatures contribution  
  estimate += signatureCount * averageSignatureSize

  // Per-page content (text, tables)
  estimate += pageCount * (hasTable ? 15000 : 5000)

  return estimate
}
