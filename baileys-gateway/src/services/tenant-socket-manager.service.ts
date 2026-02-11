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
import QRCode from 'qrcode';
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
    last_disconnect_code: number | null;
    last_disconnect_reason: string | null;
    has_qr: boolean;
    last_qr_at: string | null;
}

export interface TenantQRResponse {
    ok: boolean;
    tenant_id: string;
    pairing_state: PairingState;
    connected: boolean;
    qr: string | null;
    qr_format: 'raw';
    qr_png_base64: string | null;
    generated_at: string | null;
    expires_in_sec: number;
}

interface TenantSocketState {
    socket: WASocket | null;
    isReady: boolean;
    isInitializing: boolean;
    isShuttingDown: boolean;
    manualDisconnect: boolean;
    pairingState: PairingState;
    phoneNumber: string | null;
    pushName: string | null;
    lastConnectedAt: string | null;
    lastError: string | null;
    lastDisconnectCode: number | null;
    lastDisconnectReason: string | null;
    qrCode: string | null;
    qrExpiry: number;
    lastQrAt: string | null;
    reconnectAttempts: number;
    authPath: string;
    startLock: boolean;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
    lastSocketCreatedAt: number;
    connectedSince: number;
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
                manualDisconnect: false,
                pairingState: 'disconnected',
                phoneNumber: null,
                pushName: null,
                lastConnectedAt: null,
                lastError: null,
                lastDisconnectCode: null,
                lastDisconnectReason: null,
                qrCode: null,
                qrExpiry: 0,
                lastQrAt: null,
                reconnectAttempts: 0,
                authPath: this.getTenantAuthPath(tenantId),
                startLock: false,
                reconnectTimer: null,
                lastSocketCreatedAt: 0,
                connectedSince: 0,
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

        // Reconnect timer is pending - don't race with it
        if (state.pairingState === 'reconnecting' || state.reconnectTimer) {
            return state;
        }

        // Waiting for QR - socket exists and is working
        if (state.pairingState === 'waiting_qr' && state.socket) {
            return state;
        }

        // Cooldown: don't create a new socket within 5 seconds of the last one
        const sinceLastCreate = Date.now() - state.lastSocketCreatedAt;
        if (sinceLastCreate < 5000 && state.lastSocketCreatedAt > 0) {
            logger.debug({ tenantId, sinceLastCreate }, 'Socket creation cooldown active');
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
     * Cancel any pending reconnect timer for a tenant
     */
    private cancelReconnectTimer(tenantId: string): void {
        const state = this.sockets.get(tenantId);
        if (state?.reconnectTimer) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = null;
            logger.debug({ tenantId }, 'Reconnect timer cancelled');
        }
    }

    /**
     * Cleanup existing socket for a tenant
     */
    private cleanupSocket(tenantId: string): void {
        const state = this.sockets.get(tenantId);
        if (!state) return;

        // Cancel pending reconnect timer first
        this.cancelReconnectTimer(tenantId);

        if (state.socket) {
            try {
                state.socket.ev.removeAllListeners('connection.update');
                state.socket.ev.removeAllListeners('creds.update');
                state.socket.ev.removeAllListeners('messages.upsert');
                state.socket.ev.removeAllListeners('contacts.update');
                state.socket.end(undefined);
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

        // Cooldown: prevent rapid socket creation (< 5s)
        const sinceLastCreate = Date.now() - state.lastSocketCreatedAt;
        if (sinceLastCreate < 5000 && state.lastSocketCreatedAt > 0) {
            logger.warn({ tenantId, sinceLastCreate }, 'Socket creation too fast, deferring...');
            return;
        }

        // Ensure strict singleton - cancel timers and cleanup first
        this.cleanupSocket(tenantId);

        state.isInitializing = true;
        state.pairingState = 'connecting';
        state.lastSocketCreatedAt = Date.now();

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
                printQRInTerminal: false,
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

                // Forward messages to Moltbot via webhook
                if (m.messages && m.messages.length > 0 && m.type === 'notify') {
                    for (const message of m.messages) {
                        // Only forward text messages (both inbound and outbound)
                        if (message.message?.conversation || message.message?.extendedTextMessage?.text) {
                            // Forward both fromMe=false (user) AND fromMe=true (admin)
                            webhookService.forwardToMoltbot(tenantId, message, state.phoneNumber || undefined)
                                .catch(err => logger.error({ tenantId, error: err.message }, 'Webhook forward failed'));
                        }
                    }
                }
            });

            // Listen for contacts.update to capture push name (often arrives after connection opens)
            state.socket.ev.on('contacts.update', (updates: any[]) => {
                if (!state.phoneNumber) return;
                for (const contact of updates) {
                    // Check if this is the user's own contact (by matching JID prefix)
                    const contactPhone = contact.id?.split('@')[0]?.split(':')[0];
                    if (contactPhone === state.phoneNumber && contact.notify) {
                        logger.info({ tenantId, pushName: contact.notify }, 'Push name received from contacts.update');
                        state.pushName = contact.notify;
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

            // Capture structured disconnect info
            state.lastDisconnectCode = statusCode || null;
            state.lastDisconnectReason = error?.message || 'Connection closed';

            logger.info({ tenantId, statusCode, shouldReconnect, reason: error?.message, manualDisconnect: state.manualDisconnect }, 'Connection closed');

            // Cancel any pending reconnect timer from previous cycle
            this.cancelReconnectTimer(tenantId);

            state.qrCode = null;
            state.pairingState = 'disconnected';

            // Store human-readable error
            state.lastError = error?.message || `Disconnected (code: ${statusCode || 'unknown'})`;

            // If manual disconnect, do NOT auto-reconnect
            if (state.manualDisconnect) {
                logger.info({ tenantId }, 'Manual disconnect flag set - skipping auto-reconnect');
                state.reconnectAttempts = 0;
                return;
            }

            if (shouldReconnect && !state.isShuttingDown && state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                state.reconnectAttempts++;
                const delay = this.getBackoffDelay(state.reconnectAttempts);

                logger.info({ tenantId, attempt: state.reconnectAttempts, delay }, `Reconnecting in ${delay}ms...`);
                state.pairingState = 'reconnecting';

                // Store timer reference so we can cancel it later
                state.reconnectTimer = setTimeout(async () => {
                    state.reconnectTimer = null; // Clear ref before executing
                    if (!state.isShuttingDown && !state.manualDisconnect) {
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

            // Cancel any pending reconnect timer - we're connected now
            this.cancelReconnectTimer(tenantId);

            state.pairingState = 'connected';
            state.lastConnectedAt = new Date().toISOString();
            state.connectedSince = Date.now();
            state.lastError = null; // Clear error on success
            state.qrCode = null;
            state.isReady = true;
            // Only reset reconnect attempts after stable connection (don't reset here,
            // reset after 30s of stable connection via timer)

            // Get user info
            if (state.socket?.user) {
                state.phoneNumber = state.socket.user.id.split(':')[0] || state.socket.user.id.split('@')[0];
                state.pushName = state.socket.user.name
                    || (state.socket.user as any).verifiedName
                    || (state.socket.user as any).notify
                    || null;
                logger.info({ tenantId, phoneNumber: state.phoneNumber, pushName: state.pushName }, 'User info');

                // If pushName is null, try to fetch profile picture/name after a delay
                if (!state.pushName && state.socket) {
                    const sock = state.socket;
                    const phone = state.phoneNumber;
                    setTimeout(async () => {
                        try {
                            if (state.pairingState === 'connected' && phone) {
                                // Try fetching contact info from Baileys
                                const jid = `${phone}@s.whatsapp.net`;
                                const status = await sock.fetchStatus(jid);
                                if (status && (status as any).status) {
                                    logger.info({ tenantId, status: (status as any).status }, 'Got user status text');
                                }
                                // pushName often arrives via contacts.update event (handled separately)
                            }
                        } catch (e) {
                            // Ignore - push name will be captured via contacts.update
                        }
                    }, 3000);
                }
            }

            // Reset reconnect attempts after 30 seconds of stable connection
            setTimeout(() => {
                if (state.pairingState === 'connected' && state.connectedSince > 0 &&
                    Date.now() - state.connectedSince >= 25000) {
                    state.reconnectAttempts = 0;
                    logger.debug({ tenantId }, 'Stable connection - reconnect attempts reset');
                }
            }, 30000);

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
            last_disconnect_code: state.lastDisconnectCode,
            last_disconnect_reason: state.lastDisconnectReason,
            has_qr: !!(state.qrCode && state.qrExpiry > Date.now()),
            last_qr_at: state.lastQrAt,
        };
    }

    /**
     * Get QR code for a tenant (with PNG base64 encoding)
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
                connected: true,
                qr: null,
                qr_format: 'raw',
                qr_png_base64: null,
                generated_at: null,
                expires_in_sec: 0,
            };
        }

        // If we have a valid QR code
        if (state.qrCode && state.qrExpiry > Date.now()) {
            const expiresInSec = Math.max(0, Math.floor((state.qrExpiry - Date.now()) / 1000));

            // Generate PNG base64 from raw QR string
            let pngBase64: string | null = null;
            try {
                const pngDataUrl = await QRCode.toDataURL(state.qrCode, {
                    errorCorrectionLevel: 'M',
                    type: 'image/png',
                    margin: 2,
                    width: 300,
                });
                pngBase64 = pngDataUrl;
            } catch (qrErr) {
                logger.error({ tenantId, error: qrErr }, 'Failed to generate QR PNG');
            }

            return {
                ok: true,
                tenant_id: tenantId,
                pairing_state: state.pairingState,
                connected: false,
                qr: state.qrCode,
                qr_format: 'raw',
                qr_png_base64: pngBase64,
                generated_at: state.lastQrAt,
                expires_in_sec: expiresInSec,
            };
        }

        // QR expired or not available yet
        return {
            ok: true,
            tenant_id: tenantId,
            pairing_state: state.pairingState,
            connected: false,
            qr: null,
            qr_format: 'raw',
            qr_png_base64: null,
            generated_at: null,
            expires_in_sec: 0,
        };
    }

    /**
     * Reset session for a tenant (delete auth and reconnect) - LEGACY
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
            state.lastDisconnectCode = null;
            state.lastDisconnectReason = null;
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
     * Logout from WhatsApp (safe, no auto-reconnect)
     */
    async logoutSession(tenantId: string): Promise<{ ok: boolean }> {
        logger.info({ tenantId }, 'Logging out session...');
        const state = this.getOrCreateState(tenantId);

        // Set manual disconnect flag FIRST to prevent auto-reconnect
        state.manualDisconnect = true;

        if (state.socket) {
            try {
                await state.socket.logout();
            } catch (error: any) {
                logger.warn({ tenantId, error: error.message }, 'Logout error (continuing anyway)');
            }
            this.cleanupSocket(tenantId);
        }

        state.isReady = false;
        state.pairingState = 'disconnected';
        state.qrCode = null;

        return { ok: true };
    }

    /**
     * Clear auth state for a tenant (public method for change-number flow)
     */
    async clearSession(tenantId: string): Promise<{ ok: boolean }> {
        logger.info({ tenantId }, 'Clearing session auth...');
        const state = this.getOrCreateState(tenantId);

        // Delete auth directory contents
        this.clearTenantAuth(tenantId);

        // Reset all session data
        state.phoneNumber = null;
        state.pushName = null;
        state.lastConnectedAt = null;
        state.lastError = null;
        state.lastDisconnectCode = null;
        state.lastDisconnectReason = null;
        state.qrCode = null;
        state.lastQrAt = null;

        return { ok: true };
    }

    /**
     * Start a new session (with single-flight lock to prevent double-start)
     */
    async startSession(tenantId: string): Promise<{ ok: boolean }> {
        logger.info({ tenantId }, 'Starting session...');
        const state = this.getOrCreateState(tenantId);

        // Single-flight lock
        if (state.startLock) {
            logger.warn({ tenantId }, 'Start already in progress (locked)');
            return { ok: true };
        }

        state.startLock = true;
        try {
            // Clear manual disconnect flag
            state.manualDisconnect = false;
            state.reconnectAttempts = 0;

            // Initialize socket (will generate new QR)
            await this.initializeSocket(tenantId);

            return { ok: true };
        } catch (error: any) {
            logger.error({ tenantId, error: error.message }, 'Failed to start session');
            state.lastError = error.message;
            throw error;
        } finally {
            state.startLock = false;
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
