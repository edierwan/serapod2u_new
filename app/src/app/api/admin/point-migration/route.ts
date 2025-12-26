import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import Papa from 'papaparse'

// Initialize Supabase Admin Client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function normalizePhone(phone: string): string {
    let cleaned = String(phone).replace(/[^0-9+]/g, '')
    
    // If starts with 0, replace with +60 (Malaysia default)
    if (cleaned.startsWith('0')) {
        cleaned = '+60' + cleaned.substring(1)
    }
    // If starts with 60, add +
    else if (cleaned.startsWith('60')) {
        cleaned = '+' + cleaned
    }
    // If no country code (e.g. 123456789), assume +60
    else if (!cleaned.startsWith('+')) {
        cleaned = '+60' + cleaned
    }

    // Validation for Malaysia numbers
    // Must start with +60
    // Length must be 12 or 13 digits (including +)
    // e.g. +60123456789 (12) or +601112345678 (13)
    if (cleaned.startsWith('+60')) {
        if (cleaned.length < 12 || cleaned.length > 13) {
            throw new Error(`Invalid Malaysian phone number length: ${cleaned}`)
        }
    }
    
    return cleaned
}

function parseDate(dateStr: any): string {
    if (!dateStr) return new Date().toISOString()
    
    // If it's already a Date object (from ExcelJS)
    if (dateStr instanceof Date) {
        return dateStr.toISOString()
    }

    const str = String(dateStr).trim()
    
    // Handle DD/MM/YYYY format (e.g. 11/01/2025)
    if (str.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
        const [day, month, year] = str.split('/').map(Number)
        // Note: Month is 0-indexed in JS Date
        const date = new Date(year, month - 1, day)
        if (!isNaN(date.getTime())) {
            return date.toISOString()
        }
    }
    
    // Try standard parsing
    const date = new Date(str)
    if (!isNaN(date.getTime())) {
        return date.toISOString()
    }
    
    // Fallback to now if invalid
    console.warn(`Invalid date format: ${str}, using current time`)
    return new Date().toISOString()
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const defaultPassword = formData.get('defaultPassword') as string
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const rows: any[] = []

    if (file.name.toLowerCase().endsWith('.csv')) {
        const text = new TextDecoder().decode(buffer)
        const { data: csvRows } = Papa.parse(text, { header: false, skipEmptyLines: true }) as any
        
        csvRows.forEach((row: any[], index: number) => {
            if (index === 0) return // Skip header
            
            const rawPhone = row[2]
            if (rawPhone) {
                rows.push({
                    rowNumber: index + 1,
                    joinedDate: row[0],
                    name: row[1],
                    phone: rawPhone, // Store raw phone, validate later
                    email: row[3]?.trim(),
                    location: row[4],
                    points: Number(row[5]) || 0
                })
            }
        })
    } else {
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(buffer)
        
        const worksheet = workbook.getWorksheet(1)
        if (!worksheet) {
            return NextResponse.json({ error: 'Invalid Excel file' }, { status: 400 })
        }

        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return // Skip header

          // Columns: A=Joined Date, B=Name, C=Phone, D=Email, E=Location, F=Points
          const joinedDate = row.getCell(1).value
          const name = row.getCell(2).text
          const rawPhone = row.getCell(3).text
          const email = row.getCell(4).text
          const location = row.getCell(5).text
          const points = row.getCell(6).value

          if (rawPhone) {
            rows.push({
                rowNumber,
                joinedDate,
                name,
                phone: rawPhone, // Store raw phone, validate later
                email: email?.trim(),
                location,
                points: Number(points) || 0
            })
          }
        })
    }

    const results: any[] = []

    for (const row of rows) {
        try {
            // 0. Validate Phone (Strict)
            let normalizedPhone: string
            try {
                normalizedPhone = normalizePhone(row.phone)
            } catch (e: any) {
                throw new Error(e.message)
            }

            // 1. Find user by phone OR email separately to handle conflicts
            // Check Phone first
            const { data: phoneUsers } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('phone', normalizedPhone)
            
            // Check Email second
            let emailUser = null
            if (row.email) {
                const { data: emailUsers } = await supabaseAdmin
                    .from('users')
                    .select('*')
                    .eq('email', row.email)
                emailUser = emailUsers?.[0]
            }

            let user = phoneUsers?.[0]

            // Conflict Check: Phone belongs to User A, Email belongs to User B
            if (user && emailUser && user.id !== emailUser.id) {
                throw new Error(`Conflict: Phone belongs to user ${user.id}, Email belongs to user ${emailUser.id}`)
            }

            // If found by email but not phone, use the email user
            if (!user && emailUser) {
                user = emailUser
            }

            // If user not found, create new user
            if (!user) {
                if (!defaultPassword) {
                    throw new Error('User not found and no default password provided')
                }

                // Create Auth User
                // We need to handle the case where Auth user exists but Public user doesn't (rare edge case)
                // Or if our lookup failed for some reason.
                const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
                    email: row.email,
                    password: defaultPassword,
                    phone: normalizedPhone,
                    email_confirm: true,
                    phone_confirm: true,
                    user_metadata: {
                        full_name: row.name,
                        location: row.location
                    }
                })

                if (authError) {
                    // If email/phone exists in Auth but we didn't find it in public.users, we can't proceed easily without manual intervention
                    // or we could try to link it. For now, treat as error.
                    throw new Error(`Auth Creation Failed: ${authError.message}`)
                }
                
                if (!authUser.user) throw new Error('Failed to create auth user')

                // NOTE: A trigger on auth.users automatically creates the public.users record.
                // We do NOT need to insert manually, as that causes a duplicate key error.
                // We just prepare the user object for the subsequent update steps.

                user = {
                    id: authUser.user.id,
                    email: row.email,
                    phone: normalizedPhone,
                    full_name: row.name,
                    location: row.location,
                    role_code: 'GUEST', // Use GUEST role (the correct role for end-user consumers)
                    organization_id: null,
                    created_at: parseDate(row.joinedDate),
                    last_migration_point_value: 0
                }
                
                // No need to update role since trigger creates it as GUEST already
            }

            // 2. Update User Details
            const updates: any = {
                full_name: row.name,
                location: row.location
            }
            
            // Only update email/phone if they are missing or we want to enforce sync?
            // For migration, we usually trust the file.
            if (row.email) updates.email = row.email
            if (normalizedPhone) updates.phone = normalizedPhone
            
            if (row.joinedDate) {
                updates.created_at = parseDate(row.joinedDate)
            }

            // 3. Calculate Points
            // Get current balance from view
            const { data: balanceData } = await supabaseAdmin
                .from('v_consumer_points_balance')
                .select('current_balance')
                .eq('user_id', user.id)
                .single()
            
            const realCurrentBalance = balanceData?.current_balance || 0
            const lastMigrationValue = user.last_migration_point_value || 0
            const newMigrationValue = row.points
            const delta = newMigrationValue - lastMigrationValue

            if (delta !== 0) {
                // Add Transaction
                const { error: transactionError } = await supabaseAdmin.from('points_transactions').insert({
                    user_id: user.id,
                    company_id: null,
                    consumer_phone: normalizedPhone,
                    consumer_email: row.email || user.email,
                    transaction_type: 'MIGRATION',
                    points_amount: delta,
                    balance_after: realCurrentBalance + delta,
                    description: `Migration: ${newMigrationValue} (Prev: ${lastMigrationValue})`,
                    transaction_date: new Date().toISOString()
                })

                if (transactionError) {
                    throw new Error(`Transaction Insert Failed: ${transactionError.message}`)
                }
                
                // Update last_migration_point_value
                updates.last_migration_point_value = newMigrationValue
            }

            // Update User
            const { error: updateError } = await supabaseAdmin
                .from('users')
                .update(updates)
                .eq('id', user.id)

            if (updateError) throw new Error(`Update Failed: ${updateError.message}`)

            results.push({ ...row, status: 'Success', message: `Delta: ${delta}` })

        } catch (err: any) {
            console.error(err)
            results.push({ ...row, status: 'Error', message: err.message })
        }
    }

    // Generate Result Excel
    const resultWorkbook = new ExcelJS.Workbook()
    const sheet = resultWorkbook.addWorksheet('Migration Results')
    
    sheet.columns = [
        { header: 'Joined Date', key: 'joinedDate', width: 15 },
        { header: 'Name', key: 'name', width: 20 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Email', key: 'email', width: 25 },
        { header: 'Location', key: 'location', width: 15 },
        { header: 'Points', key: 'points', width: 10 },
        { header: 'Status', key: 'status', width: 10 },
        { header: 'Message', key: 'message', width: 30 }
    ]

    results.forEach(r => {
        sheet.addRow({
            joinedDate: r.joinedDate,
            name: r.name,
            phone: r.phone,
            email: r.email,
            location: r.location,
            points: r.points,
            status: r.status,
            message: r.message
        })
    })

    const bufferOut = await resultWorkbook.xlsx.writeBuffer()

    return new NextResponse(bufferOut, {
        status: 200,
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="migration_results.xlsx"'
        }
    })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
