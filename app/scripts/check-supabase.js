const fs = require('fs');
const path = require('path');
const https = require('https');

// Simple .env parser since we might not have dotenv
function parseEnv(content) {
  const env = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  });
  return env;
}

async function checkSupabase() {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (!fs.existsSync(envPath)) {
      console.error('❌ .env.local not found at ' + envPath);
      return;
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    const env = parseEnv(envContent);

    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      console.error('❌ Missing Supabase variables in .env.local');
      console.log('URL present:', !!url);
      console.log('Key present:', !!key);
      return;
    }

    console.log(`Checking connection to: ${url}`);
    
    // Check main URL
    try {
        const res = await fetch(`${url}/rest/v1/`, {
            headers: {
                'apikey': key,
                'Authorization': `Bearer ${key}`
            }
        });
        console.log(`REST API Status: ${res.status} ${res.statusText}`);
        if (res.ok) {
            console.log('✅ REST API connection successful');
        } else {
            console.error('❌ REST API connection failed');
            const text = await res.text();
            console.error('Response:', text);
        }
    } catch (e) {
        console.error('❌ REST API fetch threw error:', e.message);
    }

    // Check Auth URL
    try {
        const authRes = await fetch(`${url}/auth/v1/health`, {
             headers: {
                'apikey': key
            }
        });
         console.log(`Auth Health Status: ${authRes.status} ${authRes.statusText}`);
         if (authRes.ok) {
             console.log('✅ Auth service is healthy');
         } else {
             // 404 is common for health check if not enabled/supported on older versions, 
             // but let's try the settings endpoint or similar
             console.log('⚠️ Auth health check failed, trying settings...');
         }
    } catch (e) {
        console.error('❌ Auth API fetch threw error:', e.message);
    }

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

checkSupabase();
