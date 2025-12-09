
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../app/.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.log('Missing credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function inspectBatch() {
  const batchId = '2882c288-cd30-43c5-b736-a2724508bfd7'
  
  console.log('Inspecting batch:', batchId)

  // Get a chunk of codes
  const { data: codes, error: codeError } = await supabase
    .from('qr_codes')
    .select('id, code, variant_key')
    .eq('batch_id', batchId)
    .eq('status', 'ready_to_ship')
    .limit(200)

  if (codeError) {
    console.error('Code error:', codeError)
    return
  }
  
  console.log(`Found ${codes?.length} codes to update`)

  if (codes && codes.length > 0) {
    const ids = codes.map(c => c.id)
    console.log('Attempting to update IDs:', ids.length)
    
    const { data, error } = await supabase
      .from('qr_codes')
      .update({ status: 'received_warehouse' })
      .in('id', ids)
      .select('id')
      
    if (error) {
      console.error('Update failed:', error)
      // Try one by one to find the culprit
      console.log('Trying one by one...')
      for (const code of codes) {
         const { error: singleError } = await supabase
            .from('qr_codes')
            .update({ status: 'received_warehouse' })
            .eq('id', code.id)
         
         if (singleError) {
             console.error(`Failed code ${code.id} (${code.code}):`, singleError)
         }
      }
    } else {
      console.log('Update success:', data.length)
    }
  }
}

inspectBatch()
