/**
 * PM2 Ecosystem Configuration for Baileys Gateway (Multi-Tenant)
 * 
 * Single source of truth for environment variables and process settings.
 * Deploy to: /opt/baileys-gateway/ecosystem.config.cjs
 * 
 * IMPORTANT: API keys are now managed per-tenant in tenants.json
 * No more global API_KEY environment variable.
 * 
 * Usage:
 *   pm2 delete baileys-gateway || true
 *   pm2 start /opt/baileys-gateway/ecosystem.config.cjs
 *   pm2 save
 */

module.exports = {
  apps: [
    {
      name: 'baileys-gateway',
      script: '/opt/baileys-gateway/dist/index.js',
      cwd: '/opt/baileys-gateway',

      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOST: '0.0.0.0',
        
        // Multi-tenant auth root: each tenant gets ${AUTH_ROOT}/tenant_${tenantId}
        AUTH_ROOT: '/opt/baileys-gateway/auth',
        
        // Tenant registry file path (default: /opt/baileys-gateway/tenants.json)
        // TENANTS_FILE_PATH: '/opt/baileys-gateway/tenants.json',
        
        // CORS allowed origins
        ALLOWED_ORIGINS: 'https://app.serapod2u.com,https://serapod2u.com',
        
        // Logging
        LOG_LEVEL: 'info',
      },

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      exp_backoff_restart_delay: 100,

      // Watch settings (disabled for production)
      watch: false,
      ignore_watch: ['node_modules', 'auth', 'logs', '*.log'],

      // Logging
      out_file: '/var/log/baileys-gateway/out.log',
      error_file: '/var/log/baileys-gateway/err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Process management
      exec_mode: 'fork',
      instances: 1,
      kill_timeout: 5000,
      listen_timeout: 10000,
      
      // Memory management
      max_memory_restart: '500M',
    },
  ],
};
