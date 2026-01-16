import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

export async function POST(request: NextRequest) {
    const supabase = await createClient()

    // Auth check
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const formData = await request.formData()
        const file = formData.get('file') as File
        
        if (!file) {
            return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
        }

        const buffer = Buffer.from(await file.arrayBuffer())

        // Process image with sharp: Force 16:9 ratio (1280x720)
        // fit: 'cover' ensures no overflow/padding, but cropping occurs
        // position: 'entropy' focuses on the most interesting part of the image, or 'center'
        const processedImageBuffer = await sharp(buffer)
            .resize({
                width: 1280,
                height: 720,
                fit: 'cover',
                position: 'center' 
            })
            .jpeg({ quality: 85 })
            .toBuffer()

        // Generate filename
        const fileName = `master-banner-${Date.now()}.jpg`
        const filePath = `journey-images/${fileName}`

        // Upload to Supabase
        const { error: uploadError } = await supabase.storage
            .from('product-images')
            .upload(filePath, processedImageBuffer, {
                contentType: 'image/jpeg',
                cacheControl: '3600',
                upsert: true
            })

        if (uploadError) {
            console.error('Supabase storage upload error:', uploadError)
            throw uploadError
        }

        // Get public URL
        const { data: urlData } = supabase.storage
            .from('product-images')
            .getPublicUrl(filePath)

        return NextResponse.json({ 
            success: true, 
            url: urlData.publicUrl 
        })

    } catch (error: any) {
        console.error('Upload error:', error)
        return NextResponse.json({ success: false, error: error.message || 'Upload failed' }, { status: 500 })
    }
}
