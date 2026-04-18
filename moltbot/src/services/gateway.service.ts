// src/services/gateway.service.ts
import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { toProviderPhone } from '../../../shared/phone/index.js';

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
   * Convert canonical/internal phone format to provider digits
   */
  private normalizePhone(phone: string): string {
    return toProviderPhone(phone) || '';
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
