/**
 * Baileys Gateway - Multi-Tenant Entry Point
 * 
 * A production-grade multi-tenant WhatsApp Gateway using Baileys with HTTP API.
 * Supports tenant isolation with per-tenant auth folders and API keys.
 * 
 * Tenant Endpoints:
 *   GET  /tenants/:tenantId/status
 *   POST /tenants/:tenantId/session/reset
 *   GET  /tenants/:tenantId/session/qr
 *   POST /tenants/:tenantId/messages/send
 * 
 * Legacy Endpoints (map to default tenant serapod2u):
 *   GET  /status
 *   POST /session/reset
 *   GET  /session/qr
 *   POST /messages/send
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { tenantSocketManager } from './services/tenant-socket-manager.service';
import { tenantRegistry } from './services/tenant-registry.service';
import { requireTenantAuth, requireLegacyAuth, AuthenticatedRequest } from './utils/auth-middleware';
import { 
  resetRateLimiter, 
  qrRateLimiter, 
  sendRateLimiter, 
  statusRateLimiter,
  shutdownRateLimiter 
} from './utils/rate-limiter';
import { logger } from './utils/logger';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];

// Middleware
app.use(express.json());
app.use(cors({
  origin: ALLOWED_ORIGINS.includes('*') ? '*' : ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
}));

// Trust proxy for rate limiting (nginx)
app.set('trust proxy', 1);

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info({ method: req.method, path: req.path, ip: req.ip }, 'Request received');
  next();
});

// ============================================
// PUBLIC ROUTES (no auth required)
// ============================================

/**
 * GET /health
 * Public health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    ok: true,
    version: '2.0.0-multitenant',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    tenants_registered: tenantRegistry.getAllTenantIds().length,
    tenants_active: tenantSocketManager.getActiveTenantIds().length,
  });
});

// ============================================
// TENANT-SCOPED ROUTES
// ============================================

/**
 * GET /tenants/:tenantId/status
 * Returns gateway connection status for a tenant
 */
app.get(
  '/tenants/:tenantId/status',
  statusRateLimiter,
  requireTenantAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const status = await tenantSocketManager.getStatus(tenantId);
      res.json(status);
    } catch (error: any) {
      logger.error({ error: error.message, tenantId: req.tenantId }, 'Error getting status');
      res.status(500).json({ ok: false, error: error.message || 'Failed to get status' });
    }
  }
);

/**
 * POST /tenants/:tenantId/session/reset
 * Resets the session to change WhatsApp number
 */
app.post(
  '/tenants/:tenantId/session/reset',
  resetRateLimiter,
  requireTenantAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      logger.info({ tenantId }, 'Session reset requested');
      const result = await tenantSocketManager.resetSession(tenantId);
      res.json(result);
    } catch (error: any) {
      logger.error({ error: error.message, tenantId: req.tenantId }, 'Error resetting session');
      res.status(500).json({ ok: false, error: error.message || 'Failed to reset session' });
    }
  }
);

/**
 * GET /tenants/:tenantId/session/qr
 * Returns QR code for pairing (raw QR string)
 */
app.get(
  '/tenants/:tenantId/session/qr',
  qrRateLimiter,
  requireTenantAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const qrData = await tenantSocketManager.getQR(tenantId);
      res.json(qrData);
    } catch (error: any) {
      logger.error({ error: error.message, tenantId: req.tenantId }, 'Error getting QR');
      res.status(500).json({ ok: false, error: error.message || 'Failed to get QR code' });
    }
  }
);

/**
 * POST /tenants/:tenantId/messages/send
 * Send a WhatsApp message
 */
app.post(
  '/tenants/:tenantId/messages/send',
  sendRateLimiter,
  requireTenantAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { to, text, message } = req.body;
      const messageText = text || message;

      if (!to || !messageText) {
        return res.status(400).json({ ok: false, error: 'Missing required fields: to, text' });
      }

      const result = await tenantSocketManager.sendMessage(tenantId, to, messageText);
      res.json(result);
    } catch (error: any) {
      logger.error({ error: error.message, tenantId: req.tenantId }, 'Error sending message');
      res.status(500).json({ ok: false, error: error.message || 'Failed to send message' });
    }
  }
);

// ============================================
// LEGACY ROUTES (backward compatibility - map to serapod2u)
// ============================================

/**
 * GET /status (legacy)
 * Maps to /tenants/serapod2u/status
 */
app.get(
  '/status',
  statusRateLimiter,
  requireLegacyAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const status = await tenantSocketManager.getStatus(tenantId);
      
      // Return legacy format (without tenant_id wrapper)
      res.json({
        connected: status.connected,
        pairing_state: status.pairing_state,
        phone_number: status.phone_number,
        push_name: status.push_name,
        last_connected_at: status.last_connected_at,
        last_error: status.last_error,
        uptime: process.uptime(),
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error getting status (legacy)');
      res.status(500).json({ error: 'Failed to get status' });
    }
  }
);

/**
 * POST /session/reset (legacy)
 * Maps to /tenants/serapod2u/session/reset
 */
app.post(
  '/session/reset',
  resetRateLimiter,
  requireLegacyAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      logger.info({ tenantId }, 'Session reset requested (legacy)');
      const result = await tenantSocketManager.resetSession(tenantId);
      res.json(result);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error resetting session (legacy)');
      res.status(500).json({ error: error.message || 'Failed to reset session' });
    }
  }
);

/**
 * GET /session/qr (legacy)
 * Maps to /tenants/serapod2u/session/qr
 */
app.get(
  '/session/qr',
  qrRateLimiter,
  requireLegacyAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const qrData = await tenantSocketManager.getQR(tenantId);
      
      // Return legacy format
      res.json({
        qr: qrData.qr,
        expires_in_sec: qrData.expires_in_sec,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error getting QR (legacy)');
      res.status(500).json({ error: error.message || 'Failed to get QR code' });
    }
  }
);

/**
 * POST /messages/send (legacy)
 * Maps to /tenants/serapod2u/messages/send
 */
app.post(
  '/messages/send',
  sendRateLimiter,
  requireLegacyAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { to, text, message } = req.body;
      const messageText = text || message;

      if (!to || !messageText) {
        return res.status(400).json({ error: 'Missing required fields: to, text' });
      }

      const result = await tenantSocketManager.sendMessage(tenantId, to, messageText);
      
      // Return legacy format
      res.json({
        ok: result.ok,
        message_id: result.jid?.split('@')[0] || 'sent',
        error: result.error,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error sending message (legacy)');
      res.status(500).json({ ok: false, error: error.message || 'Failed to send message' });
    }
  }
);

/**
 * POST /send (legacy alias)
 */
app.post(
  '/send',
  sendRateLimiter,
  requireLegacyAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { to, text, message } = req.body;
      const messageText = text || message;

      if (!to || !messageText) {
        return res.status(400).json({ error: 'Missing required fields: to, text/message' });
      }

      const result = await tenantSocketManager.sendMessage(tenantId, to, messageText);
      res.json({
        ok: result.ok,
        message_id: result.jid?.split('@')[0] || 'sent',
        error: result.error,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error sending message (legacy /send)');
      res.status(500).json({ ok: false, error: error.message || 'Failed to send message' });
    }
  }
);

// ============================================
// ERROR HANDLERS
// ============================================

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: 'Endpoint not found' });
});

// Error Handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

// ============================================
// SERVER STARTUP
// ============================================

const server = app.listen(PORT, HOST, () => {
  logger.info(`🚀 Baileys Gateway (Multi-Tenant) running on http://${HOST}:${PORT}`);
  logger.info({
    version: '2.0.0-multitenant',
    authRoot: process.env.AUTH_ROOT || '/opt/baileys-gateway/auth',
    tenantsRegistered: tenantRegistry.getAllTenantIds(),
  }, 'Gateway initialized');
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

const gracefulShutdown = async () => {
  logger.info('Shutting down gracefully...');

  try {
    // Shutdown rate limiter cleanup
    shutdownRateLimiter();
    
    // Shutdown all tenant sockets
    await tenantSocketManager.shutdownAll();
  } catch (error: any) {
    logger.error({ error: error.message }, 'Error during shutdown');
  }

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.warn('Forcing exit after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
