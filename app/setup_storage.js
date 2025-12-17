
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function setupStorage() {
  console.log('Setting up storage...')
  
  const bucketName = 'product-images'
  
  // Check if bucket exists
  const { data: buckets, error: listError } = await supabase.storage.listBuckets()
  if (listError) {
    console.error('Error listing buckets:', listError)
    return
  }
  
  const existingBucket = buckets.find(b => b.name === bucketName)
  
  if (existingBucket) {
    console.log(`Bucket '${bucketName}' already exists.`)
  } else {
    console.log(`Creating bucket '${bucketName}'...`)
    const { data, error } = await supabase.storage.createBucket(bucketName, {
      public: true,
      fileSizeLimit: 10485760, // 10MB
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    })
    
    if (error) {
      console.error('Error creating bucket:', error)
    } else {
      console.log(`Bucket '${bucketName}' created successfully.`)
    }
  }
}

setupStorage()
