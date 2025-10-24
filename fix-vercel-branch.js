#!/usr/bin/env node

/**
 * Script to update Vercel production branch from 'develop' to 'main'
 * Run: node fix-vercel-branch.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Read project config
const projectConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '.vercel', 'project.json'), 'utf8')
);

const { projectId, orgId } = projectConfig;

// Get Vercel token from auth config
const authConfigPath = path.join(process.env.HOME, '.local', 'share', 'com.vercel.cli', 'auth.json');
let token;

try {
  const authConfig = JSON.parse(fs.readFileSync(authConfigPath, 'utf8'));
  token = authConfig.token;
} catch (err) {
  console.error('❌ Could not read Vercel auth token');
  console.error('Please run: vercel login');
  process.exit(1);
}

console.log('🔍 Project ID:', projectId);
console.log('🔍 Org ID:', orgId);
console.log('✅ Found auth token');

// Update production branch via Vercel API
const updateProductionBranch = () => {
  const data = JSON.stringify({
    gitRepository: {
      productionBranch: 'main'
    }
  });

  const options = {
    hostname: 'api.vercel.com',
    path: `/v9/projects/${projectId}`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  console.log('\n🚀 Updating production branch to "main"...\n');

  const req = https.request(options, (res) => {
    let body = '';

    res.on('data', (chunk) => {
      body += chunk;
    });

    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ SUCCESS! Production branch updated to "main"');
        console.log('\n📋 Response:', JSON.stringify(JSON.parse(body), null, 2));
        console.log('\n✨ Now www.serapod2u.com will deploy from the "main" branch!');
      } else {
        console.error('❌ Error updating production branch');
        console.error('Status:', res.statusCode);
        console.error('Response:', body);
      }
    });
  });

  req.on('error', (error) => {
    console.error('❌ Request failed:', error);
  });

  req.write(data);
  req.end();
};

// First, get current project settings
const getCurrentSettings = () => {
  const options = {
    hostname: 'api.vercel.com',
    path: `/v9/projects/${projectId}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  };

  console.log('\n🔍 Fetching current project settings...\n');

  const req = https.request(options, (res) => {
    let body = '';

    res.on('data', (chunk) => {
      body += chunk;
    });

    res.on('end', () => {
      if (res.statusCode === 200) {
        const project = JSON.parse(body);
        console.log('📊 Current Settings:');
        console.log('   Name:', project.name);
        console.log('   Production Branch:', project.link?.productionBranch || project.gitRepository?.productionBranch || 'Not set');
        console.log('   Repository:', project.link?.repo || 'Not connected');
        
        // Now update it
        updateProductionBranch();
      } else {
        console.error('❌ Could not fetch project settings');
        console.error('Status:', res.statusCode);
        console.error('Response:', body);
      }
    });
  });

  req.on('error', (error) => {
    console.error('❌ Request failed:', error);
  });

  req.end();
};

// Run
getCurrentSettings();
