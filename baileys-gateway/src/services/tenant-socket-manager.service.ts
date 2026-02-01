/**
 * Tenant Socket Manager Service
 * 
 * Manages per-tenant WhatsApp socket connections using Baileys.
 * Each tenant gets its own isolated auth folder and socket instance.
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  ConnectionState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { webhookService } from './webhook.service';

export type PairingState = 'connected' | 'waiting_qr' | 'disconnected' | 'connecting' | 'reconnecting';

export interface TenantStatus {
  ok: boolean;
  tenant_id: string;
  connected: boolean;
  pairing_state: PairingState;
  phone_number: string | null;
  push_name: string | null;
  last_connected_at: string | null;
  last_error: string | null;
  has_qr: boolean;
  last_qr_at: string | null;
}

export interface TenantQRResponse {
  ok: boolean;
  tenant_id: string;
  pairing_state: PairingState;
  qr: string | null;
  expires_in_sec: number;
}

interface TenantSocketState {
  socket: WASocket | null;
  isReady: boolean;
  isInitializing: boolean;
  isShuttingDown: boolean;
  pairingState: PairingState;
  phoneNumber: string | null;
  pushName: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  qrCode: string | null;
  qrExpiry: number;
  lastQrAt: string | null;
  reconnectAttempts: number;
  authPath: string;
}

const MAX_RECONNECT_ATTEMPTS = 50; // Increased to allow long-term recovery
const QR_EXPIRY_SECONDS = 30;
const RECONNECT_MIN_DELAY = 2000;
const RECONNECT_MAX_DELAY = 60000;

class TenantSocketManager {
  private sockets: Map<string, TenantSocketState> = new Map();
  private authRoot: string;

  constructor() {
    this.authRoot = process.env.AUTH_ROOT || '/opt/baileys-gateway/auth';
    this.ensureAuthRoot();
    logger.info({ authRoot: this.authRoot }, 'TenantSocketManager initialized');
  }

  private ensureAuthRoot(): void {
    if (!fs.existsSync(this.authRoot)) {
      fs.mkdirSync(this.authRoot, { recursive: true });
      logger.info({ path: this.authRoot }, 'Created auth root directory');
    }
  }

  /**
   * Get auth directory path for a tenant
   */
  private getTenantAuthPath(tenantId: string): string {
    return path.join(this.authRoot, `tenant_${tenantId}`);
  }

  /**
   * Ensure tenant auth directory exists
   */
  private ensureTenantAuthDir(tenantId: string): string {
    const authPath = this.getTenantAuthPath(tenantId);
    if (!fs.existsSync(authPath)) {
      fs.mkdirSync(authPath, { recursive: true });
      logger.info({ tenantId, path: authPath }, 'Created tenant auth directory');
    }
    return authPath;
  }

  /**
   * Get or create socket state for a tenant
   */
  private getOrCreateState(tenantId: string): TenantSocketState {
    let state = this.sockets.get(tenantId);
    if (!state) {
      state = {
        socket: null,
        isReady: false,
        isInitializing: false,
        isShuttingDown: false,
        pairingState: 'disconnected',
        phoneNumber: null,
        pushName: null,
        lastConnectedAt: null,
        lastError: null,
        qrCode: null,
        qrExpiry: 0,
        lastQrAt: null,
        reconnectAttempts: 0,
        authPath: this.getTenantAuthPath(tenantId),
      };
      this.sockets.set(tenantId, state);
    }
    return state;
  }

  /**
   * Initialize or get socket for a tenant (lazy creation)
   */
  async ensureSocket(tenantId: string): Promise<TenantSocketState> {
    const state = this.getOrCreateState(tenantId);

    // Already initializing or connected
    if (state.isInitializing || state.pairingState === 'connected') {
      return state;
    }

    // Socket exists but disconnected, wait a bit for it to reconnect
    if (state.socket && state.pairingState === 'reconnecting') {
      return state;
    }

    // Need to initialize
    if (!state.socket || state.pairingState === 'disconnected') {
      await this.initializeSocket(tenantId);
    }

    return state;
  }

  /**
   * Calculate backoff delay with jitter
   */
  private getBackoffDelay(attempt: number): number {
    const base = Math.min(RECONNECT_MAX_DELAY, RECONNECT_MIN_DELAY * Math.pow(1.5, attempt));
    const jitter = base * 0.1 * (Math.random() * 2 - 1); // +/- 10%
    return Math.floor(base + jitter);
  }

  /**
   * Cleanup existing socket for a tenant
   */
  private cleanupSocket(tenantId: string): void {
    const state = this.sockets.get(tenantId);
    if (state?.socket) {
      try {
        state.socket.end(undefined);
        state.socket.ev.removeAllListeners('connection.update');
        state.socket.ev.removeAllListeners('creds.update');
      } catch (e) {
        logger.error({ tenantId, error: e }, 'Error cleaning up socket');
      }
      state.socket = null;
    }
  }

  /**
   * Initialize Baileys socket for a tenant
   */
  private async initializeSocket(tenantId: string): Promise<void> {
    const state = this.getOrCreateState(tenantId);

    if (state.isInitializing) {
      logger.warn({ tenantId }, 'Already initializing, skipping...');
      return;
    }

    // Ensure strict singleton
    this.cleanupSocket(tenantId);

    state.isInitializing = true;
    state.pairingState = 'connecting';

    try {
      // Ensure auth directory exists
      const authPath = this.ensureTenantAuthDir(tenantId);
      state.authPath = authPath;

      // Get latest Baileys version
      const { version, isLatest } = await fetchLatestBaileysVersion();
      logger.info({ tenantId, version, isLatest }, 'Baileys version');

      // Load auth state
      const { state: authState, saveCreds } = await useMultiFileAuthState(authPath);

      // Create socket with minimal logger
      const socketLogger = logger.child({ tenantId });
      
      state.socket = makeWASocket({
        version,
        auth: {
          creds: authState.creds,
          keys: makeCacheableSignalKeyStore(authState.keys, socketLogger as any),
        },
        printQRInTerminal: true,
        logger: socketLogger as any,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        // Resilience settings
        connectTimeoutMs: 10_000,
        keepAliveIntervalMs: 30_000,
        defaultQueryTimeoutMs: 60_000,
        retryRequestDelayMs: 2000,
      });

      // Event handlers
      state.socket.ev.on('creds.update', saveCreds);

      state.socket.ev.on('connection.update', (update: Partial<ConnectionState>) => {
        this.handleConnectionUpdate(tenantId, update);
      });

      state.socket.ev.on('messages.upsert', (m: any) => {
        logger.debug({ tenantId, messageCount: m.messages?.length }, 'Messages received');
        
        // Forward messages to Serapod via webhook
        if (m.messages && m.messages.length > 0 && m.type === 'notify') {
          for (const message of m.messages) {
            // Only forward text messages
            if (message.message?.conversation || message.message?.extendedTextMessage?.text) {
              webhookService.forwardToSerapod(tenantId, message, state.phoneNumber || undefined)
                .catch(err => logger.error({ tenantId, error: err.message }, 'Webhook forward failed'));
            }
          }
        }
      });

      logger.info({ tenantId }, 'Socket initialized');
    } catch (error: any) {
      logger.error({ tenantId, error: error.message }, 'Failed to initialize socket');
      state.lastError = error.message; // Don't JSON.stringify here
      state.pairingState = 'disconnected';
      throw error;
    } finally {
      state.isInitializing = false;
    }
  }

  /**
   * Handle connection state updates for a tenant
   */
  private async handleConnectionUpdate(tenantId: string, update: Partial<ConnectionState>): Promise<void> {
    const state = this.sockets.get(tenantId);
    if (!state) return;

    const { connection, lastDisconnect, qr } = update;

    // Handle QR code
    if (qr) {
      logger.info({ tenantId }, 'New QR code received');
      state.qrCode = qr;
      state.qrExpiry = Date.now() + (QR_EXPIRY_SECONDS * 1000);
      state.lastQrAt = new Date().toISOString();
      state.pairingState = 'waiting_qr';
    }

    // Handle connection state changes
    if (connection === 'close') {
      const error = lastDisconnect?.error as Boom;
      const statusCode = error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      // Capture structured error
      const structuredError = {
        code: statusCode || 0,
        reason: error?.message || 'Connection closed',
        at: new Date().toISOString(),
        isLoggedOut: statusCode === DisconnectReason.loggedOut
      };

      logger.info({ tenantId, statusCode, shouldReconnect, reason: error?.message }, 'Connection closed');

      state.qrCode = null;
      state.pairingState = 'disconnected';
      
      // Store structured error as JSON string for API consumers
      state.lastError = JSON.stringify(structuredError);

      if (shouldReconnect && !state.isShuttingDown && state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        state.reconnectAttempts++;
        const delay = this.getBackoffDelay(state.reconnectAttempts);
        
        logger.info({ tenantId, attempt: state.reconnectAttempts, delay }, `Reconnecting in ${delay}ms...`);
        state.pairingState = 'reconnecting';

        // Timer for reconnect
        setTimeout(async () => {
          if (!state.isShuttingDown) {
            try {
               await this.initializeSocket(tenantId);
            } catch (e) {
               logger.error({ tenantId, error: e }, 'Reconnect failed');
            }
          }
        }, delay);

      } else if (statusCode === DisconnectReason.loggedOut) {
        logger.info({ tenantId }, 'Logged out - auth state preserved for manual action');
        state.reconnectAttempts = 0;
      } else {
        // Max retries reached
        logger.warn({ tenantId }, 'Max reconnect attempts reached');
      }
    } else if (connection === 'open') {
      logger.info({ tenantId }, 'Connection opened successfully');
      state.pairingState = 'connected';
      state.lastConnectedAt = new Date().toISOString();
      state.lastError = null; // Clear error on success
      state.qrCode = null;
      state.isReady = true;
      state.reconnectAttempts = 0;

      // Get user info
      if (state.socket?.user) {
        state.phoneNumber = state.socket.user.id.split(':')[0] || state.socket.user.id.split('@')[0];
        state.pushName = state.socket.user.name || null;
        logger.info({ tenantId, phoneNumber: state.phoneNumber, pushName: state.pushName }, 'User info');
      }
    } else if (connection === 'connecting') {
      state.pairingState = 'connecting';
      logger.info({ tenantId }, 'Connecting to WhatsApp...');
    }
  }

  /**
   * Get status for a tenant
   */
  async getStatus(tenantId: string): Promise<TenantStatus> {
    // Ensure socket exists (lazy creation)
    const state = await this.ensureSocket(tenantId);

    return {
      ok: true,
      tenant_id: tenantId,
      connected: state.pairingState === 'connected',
      pairing_state: state.pairingState,
      phone_number: state.phoneNumber,
      push_name: state.pushName,
      last_connected_at: state.lastConnectedAt,
      last_error: state.lastError,
      has_qr: !!(state.qrCode && state.qrExpiry > Date.now()),
      last_qr_at: state.lastQrAt,
    };
  }

  /**
   * Get QR code for a tenant
   */
  async getQR(tenantId: string): Promise<TenantQRResponse> {
    // Ensure socket exists (lazy creation)
    const state = await this.ensureSocket(tenantId);

    // If connected, no QR needed
    if (state.pairingState === 'connected') {
      return {
        ok: true,
        tenant_id: tenantId,
        pairing_state: 'connected',
        qr: null,
        expires_in_sec: 0,
      };
    }

    // If we have a valid QR code
    if (state.qrCode && state.qrExpiry > Date.now()) {
      const expiresInSec = Math.max(0, Math.floor((state.qrExpiry - Date.now()) / 1000));
      return {
        ok: true,
        tenant_id: tenantId,
        pairing_state: state.pairingState,
        qr: state.qrCode,
        expires_in_sec: expiresInSec,
      };
    }

    // QR expired or not available yet
    return {
      ok: true,
      tenant_id: tenantId,
      pairing_state: state.pairingState,
      qr: null,
      expires_in_sec: 0,
    };
  }

  /**
   * Reset session for a tenant (delete auth and reconnect)
   */
  async resetSession(tenantId: string): Promise<{ ok: boolean; pairing_state: PairingState }> {
    logger.info({ tenantId }, 'Resetting session...');

    const state = this.getOrCreateState(tenantId);

    try {
      // Logout if connected
      if (state.socket) {
        try {
          await state.socket.logout();
        } catch (error) {
          // Ignore logout errors
        }
        state.socket.end(undefined);
        state.socket = null;
      }

      // Clear auth state
      this.clearTenantAuth(tenantId);

      // Reset state
      state.phoneNumber = null;
      state.pushName = null;
      state.qrCode = null;
      state.lastError = null;
      state.reconnectAttempts = 0;
      state.pairingState = 'disconnected';
      state.isReady = false;

      // Reinitialize to get new QR
      await this.initializeSocket(tenantId);

      // Wait a bit for QR to be generated
      await new Promise(resolve => setTimeout(resolve, 2000));

      return {
        ok: true,
        pairing_state: this.sockets.get(tenantId)?.pairingState || 'waiting_qr',
      };
    } catch (error: any) {
      logger.error({ tenantId, error: error.message }, 'Failed to reset session');
      state.lastError = error.message;
      throw error;
    }
  }

  /**
   * Clear auth state for a tenant
   */
  private clearTenantAuth(tenantId: string): void {
    const authPath = this.getTenantAuthPath(tenantId);
    try {
      if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
        logger.info({ tenantId, path: authPath }, 'Auth state cleared');
      }
      // Recreate empty dir
      this.ensureTenantAuthDir(tenantId);
    } catch (error: any) {
      logger.error({ tenantId, error: error.message }, 'Failed to clear auth state');
    }
  }

  /**
   * Send a message for a tenant
   */
  async sendMessage(tenantId: string, to: string, text: string): Promise<{ ok: boolean; jid?: string; error?: string }> {
    const state = await this.ensureSocket(tenantId);

    if (state.pairingState !== 'connected' || !state.socket) {
      return { ok: false, error: 'Not connected to WhatsApp' };
    }

    try {
      // Normalize phone number
      let phone = to.replace(/\D/g, '');

      // Handle Malaysian numbers (starts with 0)
      if (phone.startsWith('0')) {
        phone = '60' + phone.substring(1);
      }

      // Ensure it doesn't start with +
      phone = phone.replace(/^\+/, '');

      const jid = `${phone}@s.whatsapp.net`;

      logger.info({ tenantId, jid, textLength: text.length }, 'Sending message');

      const result = await state.socket.sendMessage(jid, { text });

      logger.info({ tenantId, messageId: result?.key?.id }, 'Message sent successfully');

      return {
        ok: true,
        jid,
      };
    } catch (error: any) {
      logger.error({ tenantId, error: error.message }, 'Failed to send message');
      return { ok: false, error: error.message };
    }
  }

  /**
   * Shutdown a specific tenant socket
   */
  async shutdownTenant(tenantId: string): Promise<void> {
    const state = this.sockets.get(tenantId);
    if (!state) return;

    logger.info({ tenantId }, 'Shutting down tenant socket...');
    state.isShuttingDown = true;

    if (state.socket) {
      try {
        state.socket.end(undefined);
      } catch (error) {
        // Ignore shutdown errors
      }
      state.socket = null;
    }

    state.pairingState = 'disconnected';
    state.isReady = false;
  }

  /**
   * Shutdown all tenant sockets
   */
  async shutdownAll(): Promise<void> {
    logger.info('Shutting down all tenant sockets...');

    const promises: Promise<void>[] = [];
    for (const tenantId of this.sockets.keys()) {
      promises.push(this.shutdownTenant(tenantId));
    }

    await Promise.all(promises);
    this.sockets.clear();
  }

  /**
   * Get list of active tenant IDs
   */
  getActiveTenantIds(): string[] {
    return Array.from(this.sockets.keys()).filter(id => {
      const state = this.sockets.get(id);
      return state && state.pairingState === 'connected';
    });
  }
}

// Singleton instance
export const tenantSocketManager = new TenantSocketManager();
