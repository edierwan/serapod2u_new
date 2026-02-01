// src/services/gateway.service.ts
import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

export class GatewayService {
  private url: string;
  private apiKey: string;
  constructor() {
    this.url = config.gateway.url;
    this.apiKey = config.gateway.apiKey;
    
    // Ensure URL doesn't end with slash
    if (this.url.endsWith('/')) {
      this.url = this.url.slice(0, -1);
    }
  }

  /**
   * Normalize phone number to digits only (e.g. 60123456789)
   */
  private normalizePhone(phone: string): string {
    // Remove all non-digits
    let cleaned = phone.replace(/\D/g, '');

    // Handle Malaysian local format 012... -> 6012...
    if (cleaned.startsWith('0')) {
      cleaned = '60' + cleaned.substring(1);
    }
    
    // If it starts with 60, keep it. If just 123... (unlikely without country code), 
    // we assume it needs country code or is already intl. 
    // Baileys needs country code prefix.
    
    return cleaned;
  }
  /**
   * Send WhatsApp message via Gateway
   */
  async sendMessage(to: string, message: string): Promise<boolean> {
    const toPhone = this.normalizePhone(to);
    const endpoint = `${this.url}/messages/send`;

    logger.info({ to: toPhone, endpoint }, 'Attempting to send WhatsApp message');

    try {
      const response = await axios.post(endpoint, {
        to: toPhone,
        message: message, // Gateway API usually expects 'message' or 'text'
        text: message     // Supporting both just in case
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey
        }
      });

      logger.info({ 
        status: response.status, 
        data: response.data 
      }, 'Gateway send success');
      return true;

    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        logger.error({ 
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        }, 'Gateway send failed');
      } else {
        logger.error({ 
          error: error.message,
          stack: error.stack
        }, 'Gateway connection error');
      }
      return false;
    }
  }
}

export const gatewayService = new GatewayService();
