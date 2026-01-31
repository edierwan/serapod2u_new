/**
 * Baileys Service
 * 
 * Manages WhatsApp connection using @whiskeysockets/baileys
 * with full state management and QR code generation.
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  ConnectionState,
  BaileysEventMap,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import * as path from 'path';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export type PairingState = 'connected' | 'waiting_qr' | 'disconnected' | 'connecting' | 'reconnecting';

export interface GatewayStatus {
  connected: boolean;
  pairing_state: PairingState;
  phone_number: string | null;
  push_name: string | null;
  last_connected_at: string | null;
  last_error: string | null;
  uptime: number;
}

export interface QRResponse {
  qr: string | null;
  expires_in_sec: number;
}

export class BaileysService {
  private socket: WASocket | null = null;
  private authPath: string;
  private qrCode: string | null = null;
  private qrExpiry: number = Date.now();
  private pairingState: PairingState = 'disconnected';
  private phoneNumber: string | null = null;
  private pushName: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastError: string | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private isInitializing: boolean = false;
  private isShuttingDown: boolean = false;

  constructor() {
    this.authPath = process.env.AUTH_PATH || './auth';
    this.ensureAuthDirectory();
  }

  private ensureAuthDirectory(): void {
    if (!fs.existsSync(this.authPath)) {
      fs.mkdirSync(this.authPath, { recursive: true });
      logger.info(`Created auth directory: ${this.authPath}`);
    }
  }

  /**
   * Initialize Baileys connection
   */
  async initialize(): Promise<void> {
    if (this.isInitializing) {
      logger.warn('Already initializing, skipping...');
      return;
    }

    this.isInitializing = true;
    this.pairingState = 'connecting';

    try {
      // Get latest Baileys version
      const { version, isLatest } = await fetchLatestBaileysVersion();
      logger.info({ version, isLatest }, 'Baileys version');

      // Load auth state
      const { state, saveCreds } = await useMultiFileAuthState(this.authPath);

      // Create socket
      this.socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger as any),
        },
        printQRInTerminal: true, // Also print in terminal for debugging
        logger: logger as any,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: true,
        syncFullHistory: false,
      });

      // Event handlers
      this.socket.ev.on('creds.update', saveCreds);

      this.socket.ev.on('connection.update', (update) => {
        this.handleConnectionUpdate(update);
      });

      this.socket.ev.on('messages.upsert', (m) => {
        // Log incoming messages for debugging
        logger.debug({ messageCount: m.messages.length }, 'Messages received');
      });

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to initialize Baileys');
      this.lastError = error.message;
      this.pairingState = 'disconnected';
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Handle connection state updates
   */
  private async handleConnectionUpdate(update: Partial<ConnectionState>): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    // Handle QR code
    if (qr) {
      logger.info('New QR code received');
      try {
        this.qrCode = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: 'M',
          type: 'image/png',
          margin: 2,
          width: 300,
        });
        this.qrExpiry = Date.now() + (parseInt(process.env.QR_EXPIRY_SECONDS || '30', 10) * 1000);
        this.pairingState = 'waiting_qr';
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to generate QR code');
      }
    }

    // Handle connection state changes
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      
      logger.info({ statusCode, shouldReconnect }, 'Connection closed');
      
      this.qrCode = null;
      this.pairingState = 'disconnected';
      this.lastError = lastDisconnect?.error?.message || 'Connection closed';

      if (shouldReconnect && !this.isShuttingDown && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        logger.info({ attempt: this.reconnectAttempts }, 'Attempting to reconnect...');
        this.pairingState = 'reconnecting';
        
        // Delay before reconnect
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        if (!this.isShuttingDown) {
          await this.initialize();
        }
      } else if (statusCode === DisconnectReason.loggedOut) {
        logger.info('Logged out - clearing auth state');
        this.clearAuthState();
      }
    } else if (connection === 'open') {
      logger.info('Connection opened successfully');
      this.pairingState = 'connected';
      this.lastConnectedAt = new Date().toISOString();
      this.lastError = null;
      this.qrCode = null;
      this.reconnectAttempts = 0;

      // Get user info
      if (this.socket?.user) {
        this.phoneNumber = this.socket.user.id.split(':')[0] || this.socket.user.id.split('@')[0];
        this.pushName = this.socket.user.name || null;
        logger.info({ phoneNumber: this.phoneNumber, pushName: this.pushName }, 'User info');
      }
    } else if (connection === 'connecting') {
      this.pairingState = 'connecting';
      logger.info('Connecting to WhatsApp...');
    }
  }

  /**
   * Get current status
   */
  getStatus(): GatewayStatus {
    return {
      connected: this.pairingState === 'connected',
      pairing_state: this.pairingState,
      phone_number: this.phoneNumber,
      push_name: this.pushName,
      last_connected_at: this.lastConnectedAt,
      last_error: this.lastError,
      uptime: process.uptime(),
    };
  }

  /**
   * Get QR code for pairing
   */
  async getQR(): Promise<QRResponse> {
    // If connected, no QR needed
    if (this.pairingState === 'connected') {
      return { qr: null, expires_in_sec: 0 };
    }

    // If we have a valid QR code
    if (this.qrCode && this.qrExpiry > Date.now()) {
      const expiresInSec = Math.max(0, Math.floor((this.qrExpiry - Date.now()) / 1000));
      return { qr: this.qrCode, expires_in_sec: expiresInSec };
    }

    // If no QR and not connected, trigger reconnection to get new QR
    if (this.pairingState === 'disconnected' && !this.isInitializing) {
      logger.info('No QR available, triggering reconnection...');
      await this.initialize();
      
      // Wait a bit for QR to be generated
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (this.qrCode && this.qrExpiry > Date.now()) {
        const expiresInSec = Math.max(0, Math.floor((this.qrExpiry - Date.now()) / 1000));
        return { qr: this.qrCode, expires_in_sec: expiresInSec };
      }
    }

    // Still waiting for QR
    return { qr: null, expires_in_sec: 0 };
  }

  /**
   * Reset session (delete auth and reconnect)
   */
  async resetSession(): Promise<{ ok: boolean; pairing_state: PairingState }> {
    logger.info('Resetting session...');

    try {
      // Logout if connected
      if (this.socket) {
        try {
          await this.socket.logout();
        } catch (error) {
          // Ignore logout errors
        }
        this.socket.end(undefined);
        this.socket = null;
      }

      // Clear auth state
      this.clearAuthState();

      // Reset state
      this.phoneNumber = null;
      this.pushName = null;
      this.qrCode = null;
      this.lastError = null;
      this.reconnectAttempts = 0;
      this.pairingState = 'disconnected';

      // Reinitialize to get new QR
      await this.initialize();

      return { ok: true, pairing_state: this.pairingState };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to reset session');
      this.lastError = error.message;
      throw error;
    }
  }

  /**
   * Logout (optionally delete auth)
   */
  async logout(deleteAuth: boolean = false): Promise<{ ok: boolean }> {
    logger.info({ deleteAuth }, 'Logging out...');

    try {
      if (this.socket) {
        try {
          await this.socket.logout();
        } catch (error) {
          // Ignore logout errors
        }
        this.socket.end(undefined);
        this.socket = null;
      }

      if (deleteAuth) {
        this.clearAuthState();
      }

      this.pairingState = 'disconnected';
      this.phoneNumber = null;
      this.pushName = null;
      this.qrCode = null;

      return { ok: true };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to logout');
      throw error;
    }
  }

  /**
   * Reconnect without resetting auth
   */
  async reconnect(): Promise<{ ok: boolean; pairing_state: PairingState }> {
    logger.info('Reconnecting...');

    try {
      // Close existing connection
      if (this.socket) {
        this.socket.end(undefined);
        this.socket = null;
      }

      this.reconnectAttempts = 0;
      this.pairingState = 'disconnected';

      // Reinitialize
      await this.initialize();

      return { ok: true, pairing_state: this.pairingState };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to reconnect');
      this.lastError = error.message;
      throw error;
    }
  }

  /**
   * Send a message
   */
  async sendMessage(to: string, text: string): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    if (this.pairingState !== 'connected' || !this.socket) {
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
      
      logger.info({ jid, textLength: text.length }, 'Sending message');

      const result = await this.socket.sendMessage(jid, { text });

      logger.info({ messageId: result?.key?.id }, 'Message sent successfully');

      return {
        ok: true,
        message_id: result?.key?.id || uuidv4(),
      };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to send message');
      return { ok: false, error: error.message };
    }
  }

  /**
   * Clear auth state (delete auth folder contents)
   */
  private clearAuthState(): void {
    try {
      if (fs.existsSync(this.authPath)) {
        const files = fs.readdirSync(this.authPath);
        for (const file of files) {
          const filePath = path.join(this.authPath, file);
          if (fs.lstatSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true });
          } else {
            fs.unlinkSync(filePath);
          }
        }
        logger.info('Auth state cleared');
      }
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to clear auth state');
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Baileys service...');
    this.isShuttingDown = true;

    if (this.socket) {
      try {
        this.socket.end(undefined);
      } catch (error) {
        // Ignore shutdown errors
      }
      this.socket = null;
    }
  }
}
