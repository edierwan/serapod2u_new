/**
 * Tenant Registry Service
 * 
 * Manages tenant configuration loaded from tenants.json file.
 * Supports hot-reloading with a short cache TTL.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface Tenant {
  id: string;
  label: string;
  api_key: string;
}

interface TenantsFile {
  tenants: Tenant[];
}

// Tenant ID validation regex: alphanumeric, underscore, hyphen, 2-32 chars
const TENANT_ID_REGEX = /^[a-z0-9_-]{2,32}$/;

// Cache TTL in milliseconds (5 seconds)
const CACHE_TTL_MS = 5000;

class TenantRegistryService {
  private tenants: Map<string, Tenant> = new Map();
  private lastLoadTime: number = 0;
  private tenantsFilePath: string;

  constructor() {
    // Default path, can be overridden via env
    this.tenantsFilePath = process.env.TENANTS_FILE_PATH || 
      path.join(process.env.AUTH_ROOT || '/opt/baileys-gateway', '..', 'tenants.json');
    
    // Also check current directory if running locally
    if (!fs.existsSync(this.tenantsFilePath)) {
      const localPath = path.join(process.cwd(), 'tenants.json');
      if (fs.existsSync(localPath)) {
        this.tenantsFilePath = localPath;
      }
    }
    
    logger.info({ path: this.tenantsFilePath }, 'Tenant registry initialized');
    this.loadTenants();
  }

  /**
   * Load tenants from JSON file
   */
  private loadTenants(): void {
    try {
      if (!fs.existsSync(this.tenantsFilePath)) {
        logger.warn({ path: this.tenantsFilePath }, 'Tenants file not found, using empty registry');
        this.tenants.clear();
        this.lastLoadTime = Date.now();
        return;
      }

      const fileContent = fs.readFileSync(this.tenantsFilePath, 'utf-8');
      const data: TenantsFile = JSON.parse(fileContent);

      if (!Array.isArray(data.tenants)) {
        throw new Error('Invalid tenants.json format: missing tenants array');
      }

      // Validate and load tenants
      this.tenants.clear();
      for (const tenant of data.tenants) {
        if (!tenant.id || !tenant.api_key) {
          logger.warn({ tenant: tenant.id }, 'Skipping invalid tenant entry (missing id or api_key)');
          continue;
        }

        if (!TENANT_ID_REGEX.test(tenant.id)) {
          logger.warn({ tenant: tenant.id }, 'Skipping tenant with invalid ID format');
          continue;
        }

        this.tenants.set(tenant.id, {
          id: tenant.id,
          label: tenant.label || tenant.id,
          api_key: tenant.api_key,
        });
      }

      this.lastLoadTime = Date.now();
      logger.info({ tenantCount: this.tenants.size }, 'Tenants loaded successfully');
    } catch (error: any) {
      logger.error({ error: error.message, path: this.tenantsFilePath }, 'Failed to load tenants file');
      // Keep existing tenants on error
    }
  }

  /**
   * Ensure cache is fresh
   */
  private ensureFreshCache(): void {
    if (Date.now() - this.lastLoadTime > CACHE_TTL_MS) {
      this.loadTenants();
    }
  }

  /**
   * Get a tenant by ID
   */
  getTenant(tenantId: string): Tenant | null {
    this.ensureFreshCache();
    return this.tenants.get(tenantId) || null;
  }

  /**
   * Validate tenant exists
   */
  tenantExists(tenantId: string): boolean {
    this.ensureFreshCache();
    return this.tenants.has(tenantId);
  }

  /**
   * Validate API key for a tenant
   */
  validateApiKey(tenantId: string, apiKey: string): boolean {
    const tenant = this.getTenant(tenantId);
    if (!tenant) return false;
    return tenant.api_key === apiKey;
  }

  /**
   * Get all tenant IDs
   */
  getAllTenantIds(): string[] {
    this.ensureFreshCache();
    return Array.from(this.tenants.keys());
  }

  /**
   * Check if tenant ID is valid format
   */
  isValidTenantIdFormat(tenantId: string): boolean {
    return TENANT_ID_REGEX.test(tenantId);
  }

  /**
   * Get default tenant ID
   */
  getDefaultTenantId(): string {
    return 'serapod2u';
  }

  /**
   * Force reload tenants (for testing/admin purposes)
   */
  reloadTenants(): void {
    this.loadTenants();
  }
}

// Singleton instance
export const tenantRegistry = new TenantRegistryService();
