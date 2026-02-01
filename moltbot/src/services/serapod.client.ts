// src/services/serapod.client.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  RecognizeUserResponse,
  GetPointsBalanceResponse,
  GetRecentOrdersResponse,
  GetRedeemStatusResponse,
} from '../types';

/**
 * Serapod API client for server-to-server calls
 * Uses x-agent-key for authentication
 */
class SerapodClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.serapod.baseUrl;
    
    // Ensure no trailing slash
    if (this.baseUrl.endsWith('/')) {
      this.baseUrl = this.baseUrl.slice(0, -1);
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: config.serapod.timeout,
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': config.serapod.serviceToken,
      },
    });

    // Request logging
    this.client.interceptors.request.use((req) => {
      logger.debug({
        method: req.method,
        url: req.url,
        params: req.params,
      }, 'Serapod API request');
      return req;
    });

    // Response logging
    this.client.interceptors.response.use(
      (res) => {
        logger.debug({
          status: res.status,
          url: res.config.url,
        }, 'Serapod API response');
        return res;
      },
      (error: AxiosError) => {
        logger.error({
          status: error.response?.status,
          url: error.config?.url,
          message: error.message,
          data: error.response?.data,
        }, 'Serapod API error');
        throw error;
      }
    );

    logger.info({ baseUrl: this.baseUrl }, 'Serapod client initialized');
  }

  /**
   * Normalize phone to E.164 digits format (e.g., 60123456789)
   */
  private normalizePhone(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '60' + cleaned.substring(1);
    }
    return cleaned;
  }

  /**
   * Resolve user by phone number
   * Returns user info if found
   */
  async recognizeUser(phone: string): Promise<RecognizeUserResponse> {
    const startTime = Date.now();
    const normalizedPhone = this.normalizePhone(phone);

    try {
      // Try the bot/resolve-user endpoint first
      const response = await this.client.get('/api/bot/resolve-user', {
        params: { phone: normalizedPhone },
      });

      const data = response.data;
      logger.info({
        phone: normalizedPhone,
        found: data.found,
        durationMs: Date.now() - startTime,
      }, 'User recognition completed');

      return {
        found: data.found ?? false,
        userId: data.userId || data.user_id,
        name: data.name || data.full_name,
        roles: data.roles,
        phone: normalizedPhone,
      };
    } catch (error: any) {
      // If endpoint doesn't exist, return not found
      if (error.response?.status === 404) {
        logger.warn({ phone: normalizedPhone }, 'resolve-user endpoint not found');
        return { found: false, phone: normalizedPhone };
      }

      logger.error({
        phone: normalizedPhone,
        error: error.message,
        durationMs: Date.now() - startTime,
      }, 'User recognition failed');

      return { found: false, phone: normalizedPhone };
    }
  }

  /**
   * Get user's points balance
   */
  async getPointsBalance(params: { userId?: string; phone?: string }): Promise<GetPointsBalanceResponse> {
    const startTime = Date.now();

    try {
      const queryParams: Record<string, string> = {};
      if (params.userId) {
        queryParams.userId = params.userId;
      } else if (params.phone) {
        queryParams.phone = this.normalizePhone(params.phone);
      } else {
        return { ok: false, balance: 0, message: 'Either userId or phone is required' };
      }

      const response = await this.client.get('/api/agent/points', {
        params: queryParams,
      });

      const data = response.data;
      logger.info({
        userId: data.userId,
        balance: data.balance,
        durationMs: Date.now() - startTime,
      }, 'Points balance fetched');

      return {
        ok: data.ok ?? true,
        userId: data.userId,
        balance: data.balance ?? 0,
        tier: data.tier,
        nextTier: data.nextTier,
        lifetimeStats: data.lifetimeStats,
        message: data.message,
      };
    } catch (error: any) {
      logger.error({
        params,
        error: error.message,
        durationMs: Date.now() - startTime,
      }, 'Points balance fetch failed');

      return {
        ok: false,
        balance: 0,
        message: error.response?.data?.error || 'Failed to fetch points balance',
      };
    }
  }

  /**
   * Get user's recent orders
   */
  async getRecentOrders(params: { userId?: string; phone?: string; limit?: number }): Promise<GetRecentOrdersResponse> {
    const startTime = Date.now();

    try {
      const queryParams: Record<string, string> = {};
      if (params.userId) {
        queryParams.userId = params.userId;
      } else if (params.phone) {
        queryParams.phone = this.normalizePhone(params.phone);
      } else {
        return { ok: false, orders: [], message: 'Either userId or phone is required' };
      }
      
      if (params.limit) {
        queryParams.limit = String(params.limit);
      }

      const response = await this.client.get('/api/agent/orders', {
        params: queryParams,
      });

      const data = response.data;
      logger.info({
        userId: data.userId,
        orderCount: data.orders?.length ?? 0,
        durationMs: Date.now() - startTime,
      }, 'Orders fetched');

      // Map orders to our format
      const orders = (data.orders || []).map((o: any) => ({
        orderNo: o.orderNumber || o.order_number || o.displayDocNo || o.display_doc_no,
        status: o.status,
        totalAmount: o.totalAmount || o.total_amount,
        itemCount: o.items?.length || o.itemCount || o.item_count,
        createdAt: o.createdAt || o.created_at,
        updatedAt: o.updatedAt || o.updated_at,
      }));

      return {
        ok: data.ok ?? true,
        userId: data.userId,
        orders,
        stats: data.stats,
        message: data.message,
      };
    } catch (error: any) {
      logger.error({
        params,
        error: error.message,
        durationMs: Date.now() - startTime,
      }, 'Orders fetch failed');

      return {
        ok: false,
        orders: [],
        message: error.response?.data?.error || 'Failed to fetch orders',
      };
    }
  }

  /**
   * Get user's redemption status
   */
  async getRedeemStatus(params: { userId?: string; phone?: string; limit?: number }): Promise<GetRedeemStatusResponse> {
    const startTime = Date.now();

    try {
      const queryParams: Record<string, string> = {};
      if (params.userId) {
        queryParams.userId = params.userId;
      } else if (params.phone) {
        queryParams.phone = this.normalizePhone(params.phone);
      } else {
        return { ok: false, redemptions: [], message: 'Either userId or phone is required' };
      }
      
      if (params.limit) {
        queryParams.limit = String(params.limit);
      }

      const response = await this.client.get('/api/agent/redeems', {
        params: queryParams,
      });

      const data = response.data;
      logger.info({
        userId: data.userId,
        redemptionCount: data.redemptions?.length ?? 0,
        durationMs: Date.now() - startTime,
      }, 'Redeems fetched');

      // Map redemptions to our format
      const redemptions = (data.redemptions || []).map((r: any) => ({
        ref: r.id || r.ref,
        itemName: r.item?.name || r.itemName || r.item_name,
        pointsUsed: r.pointsUsed || r.points_used,
        status: r.status,
        createdAt: r.createdAt || r.created_at,
        updatedAt: r.updatedAt || r.updated_at,
      }));

      return {
        ok: data.ok ?? true,
        userId: data.userId,
        redemptions,
        stats: data.stats,
        currentBalance: data.currentBalance || data.current_balance,
        message: data.message,
      };
    } catch (error: any) {
      logger.error({
        params,
        error: error.message,
        durationMs: Date.now() - startTime,
      }, 'Redeems fetch failed');

      return {
        ok: false,
        redemptions: [],
        message: error.response?.data?.error || 'Failed to fetch redemptions',
      };
    }
  }

  /**
   * Health check for Serapod API
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/api/health', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const serapodClient = new SerapodClient();
