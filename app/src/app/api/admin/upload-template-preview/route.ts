import { NextRequest, NextResponse } from 'next/server'
import { writeFile } from 'fs/promises'
import path from 'path'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // 1. Check Authentication & Authorization
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is Super Admin (role_level 1)
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('roles:role_code(role_level)')
      .eq('id', user.id)
      .single()

    if (userError || !userData?.roles?.role_level || userData.roles.role_level !== 1) {
      return NextResponse.json({ error: 'Forbidden: Super Admin access required' }, { status: 403 })
    }

    // 2. Process Form Data
    const formData = await request.formData()
    const file = formData.get('file') as File
    const templateId = formData.get('templateId') as string

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    if (!templateId) {
      return NextResponse.json({ error: 'No template ID provided' }, { status: 400 })
    }

    // 3. Determine Filename
    const filenameMap: Record<string, string> = {
      'detailed': 'detailed-document.png',
      'classic': 'classic.png'
    }

    const targetFilename = filenameMap[templateId]
    if (!targetFilename) {
      return NextResponse.json({ error: 'Invalid template ID' }, { status: 400 })
    }

    // 4. Save File
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Define path: public/images/templates/
    const publicDir = path.join(process.cwd(), 'public', 'images', 'templates')
    const filePath = path.join(publicDir, targetFilename)

    await writeFile(filePath, buffer)

    return NextResponse.json({ success: true, filePath: `/images/templates/${targetFilename}` })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
