/**
 * Image Compression Utility
 * Compresses images for product images, avatars, and other media
 * Returns compressed file size info for user feedback
 */

export interface CompressionResult {
  file: File
  originalSize: number
  compressedSize: number
  compressionRatio: number
}

export interface CompressionOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  targetType?: 'image/jpeg' | 'image/png' | 'image/webp'
}

/**
 * Compress an image file
 * @param file - The image file to compress
 * @param options - Compression options
 * @returns Promise<CompressionResult> - Compressed file with size info
 */
export const compressImage = (
  file: File,
  options: CompressionOptions = {}
): Promise<CompressionResult> => {
  const {
    maxWidth = 800,
    maxHeight = 800,
    quality = 0.8,
    targetType = 'image/jpeg'
  } = options

  return new Promise((resolve, reject) => {
    const originalSize = file.size
    const reader = new FileReader()
    
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target?.result as string
      
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height
        
        // Calculate new dimensions while maintaining aspect ratio
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width)
            width = maxWidth
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height)
            height = maxHeight
          }
        }
        
        canvas.width = width
        canvas.height = height
        
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Failed to get canvas context'))
          return
        }
        
        ctx.drawImage(img, 0, 0, width, height)
        
        // Convert to specified format with compression
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const fileExtension = targetType === 'image/jpeg' ? '.jpg' : 
                                   targetType === 'image/png' ? '.png' : '.webp'
              const compressedFile = new File(
                [blob],
                file.name.replace(/\.\w+$/, fileExtension),
                {
                  type: targetType,
                  lastModified: Date.now(),
                }
              )
              
              const compressionRatio = ((originalSize - compressedFile.size) / originalSize * 100)
              
              console.log(`🖼️ Image compressed: ${(originalSize / 1024).toFixed(2)}KB → ${(compressedFile.size / 1024).toFixed(2)}KB (${compressionRatio.toFixed(1)}% reduction)`)
              
              resolve({
                file: compressedFile,
                originalSize,
                compressedSize: compressedFile.size,
                compressionRatio
              })
            } else {
              reject(new Error('Canvas to Blob conversion failed'))
            }
          },
          targetType,
          quality
        )
      }
      
      img.onerror = () => reject(new Error('Image loading failed'))
    }
    
    reader.onerror = () => reject(new Error('File reading failed'))
  })
}

/**
 * Compress avatar image (small size for user avatars)
 */
export const compressAvatar = (file: File): Promise<CompressionResult> => {
  return compressImage(file, {
    maxWidth: 200,
    maxHeight: 200,
    quality: 0.6,
    targetType: 'image/jpeg'
  })
}

/**
 * Compress product image (medium size for product catalog)
 */
export const compressProductImage = (file: File): Promise<CompressionResult> => {
  return compressImage(file, {
    maxWidth: 800,
    maxHeight: 800,
    quality: 0.8,
    targetType: 'image/jpeg'
  })
}

/**
 * Compress variant image (small-medium size for product variants)
 */
export const compressVariantImage = (file: File): Promise<CompressionResult> => {
  return compressImage(file, {
    maxWidth: 400,
    maxHeight: 400,
    quality: 0.75,
    targetType: 'image/jpeg'
  })
}

/**
 * Format file size for display
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
