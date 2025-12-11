
/**
 * Compresses an image file using the Canvas API.
 * Resizes to max dimensions and reduces quality.
 */
export interface CompressionResult {
  file: File
  originalSize: number
  compressedSize: number
  reductionPercentage: number
}

export const compressImage = async (
  file: File,
  maxWidth = 1600,
  maxHeight = 1600,
  quality = 0.7
): Promise<CompressionResult> => {
  // Only compress images
  if (!file.type.startsWith('image/')) {
    return {
      file,
      originalSize: file.size,
      compressedSize: file.size,
      reductionPercentage: 0
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    
    img.onload = () => {
      URL.revokeObjectURL(url)
      
      let width = img.width
      let height = img.height

      // Calculate new dimensions
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width))
          width = maxWidth
        }
      } else {
        if (height > maxHeight) {
          width = Math.round(width * (maxHeight / height))
          height = maxHeight
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not get canvas context'))
        return
      }

      // Draw image
      ctx.drawImage(img, 0, 0, width, height)

      // Compress
      // Use 'image/jpeg' for better compression, unless it's a PNG with transparency (which we can't easily detect without analyzing pixels, so we might stick to input type or default to jpeg for photos)
      // The requirement says "Allowed: jpg, jpeg, png, webp".
      // Converting everything to JPEG or WebP is usually best for compression.
      // Let's use the original type if supported, or JPEG as fallback.
      // Actually, to ensure good compression, JPEG/WebP is better than PNG for photos.
      // Let's default to image/jpeg for compression unless it's webp.
      const outputType = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg'

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Compression failed'))
            return
          }

          // If compressed is larger (rare but possible with low res PNGs -> High quality JPEG), use original
          if (blob.size > file.size) {
            resolve({
              file,
              originalSize: file.size,
              compressedSize: file.size,
              reductionPercentage: 0
            })
            return
          }

          const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + (outputType === 'image/webp' ? '.webp' : '.jpg'), {
            type: outputType,
            lastModified: Date.now(),
          })

          const reduction = Math.round(((file.size - compressedFile.size) / file.size) * 100)

          resolve({
            file: compressedFile,
            originalSize: file.size,
            compressedSize: compressedFile.size,
            reductionPercentage: reduction
          })
        },
        outputType,
        quality
      )
    }

    img.onerror = (error) => {
      URL.revokeObjectURL(url)
      reject(error)
    }

    img.src = url
  })
}

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
