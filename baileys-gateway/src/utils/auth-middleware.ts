/**
 * Auth Middleware
 * 
 * Validates API keys for tenant-scoped and legacy endpoints.
 * For tenant endpoints: Validates tenant exists and API key matches.
 * For legacy endpoints: Maps to default tenant (serapod2u) and validates.
 */

import { Request, Response, NextFunction } from 'express';
import { tenantRegistry } from '../services/tenant-registry.service';
import { logger } from './logger';

// Default tenant for legacy endpoints
const DEFAULT_TENANT_ID = 'serapod2u';

export interface AuthenticatedRequest extends Request {
  tenantId?: string;
}

/**
 * Extract tenant ID from route params or default to serapod2u
 */
function getTenantIdFromRequest(req: Request): string {
  // Tenant endpoints: /tenants/:tenantId/...
  if (req.params.tenantId) {
    return req.params.tenantId;
  }
  
  // Legacy endpoints map to default tenant
  return DEFAULT_TENANT_ID;
}

/**
 * Auth middleware for tenant endpoints
 * Validates that:
 * 1. Tenant exists in registry
 * 2. x-api-key header is present
 * 3. API key matches tenant's configured key
 */
export function requireTenantAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const tenantId = getTenantIdFromRequest(req);
  const apiKey = req.headers['x-api-key'] as string;

  // Validate tenant ID format
  if (!tenantRegistry.isValidTenantIdFormat(tenantId)) {
    logger.warn({ tenantId, ip: req.ip }, 'Invalid tenant ID format');
    res.status(400).json({
      ok: false,
      error: 'INVALID_TENANT_ID',
      message: 'Tenant ID must be 2-32 characters, alphanumeric with underscore and hyphen only',
    });
    return;
  }

  // Check if tenant exists
  if (!tenantRegistry.tenantExists(tenantId)) {
    logger.warn({ tenantId, ip: req.ip }, 'Tenant not found');
    res.status(404).json({
      ok: false,
      error: 'TENANT_NOT_FOUND',
      message: `Tenant '${tenantId}' not found`,
    });
    return;
  }

  // Validate API key is present
  if (!apiKey) {
    logger.warn({ tenantId, ip: req.ip }, 'Missing API key');
    res.status(401).json({
      ok: false,
      error: 'UNAUTHORIZED',
      message: 'Missing x-api-key header',
    });
    return;
  }

  // Validate API key matches tenant
  if (!tenantRegistry.validateApiKey(tenantId, apiKey)) {
    logger.warn({ tenantId, ip: req.ip }, 'Invalid API key');
    res.status(401).json({
      ok: false,
      error: 'UNAUTHORIZED',
      message: 'Invalid API key',
    });
    return;
  }

  // Attach tenant ID to request for downstream handlers
  req.tenantId = tenantId;
  
  logger.debug({ tenantId, ip: req.ip, path: req.path }, 'Tenant authenticated');
  next();
}

/**
 * Auth middleware for legacy endpoints (maps to default tenant)
 * Same validation as tenant auth, but uses default tenant ID
 */
export function requireLegacyAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Set tenant ID to default and delegate to tenant auth
  req.params.tenantId = DEFAULT_TENANT_ID;
  return requireTenantAuth(req, res, next);
}

/**
 * No-auth middleware (for health endpoint)
 * Just passes through
 */
export function noAuth(req: Request, res: Response, next: NextFunction): void {
  next();
}
