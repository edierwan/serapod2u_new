/**
 * Rate Limiter Utilities
 * 
 * Per-IP rate limiting for sensitive endpoints.
 * Implements in-memory rate limiting with sliding window.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

interface RateLimitWindow {
  count: number;
  resetTime: number;
}

interface RateLimiterConfig {
  windowMs: number;
  maxRequests: number;
  endpoint: string;
}

class InMemoryRateLimiter {
  private windows: Map<string, RateLimitWindow> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, window] of this.windows.entries()) {
      if (window.resetTime < now) {
        this.windows.delete(key);
      }
    }
  }

  /**
   * Check if request should be rate limited
   * Returns remaining requests or -1 if limited
   */
  checkLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const window = this.windows.get(key);

    // No existing window or window expired
    if (!window || window.resetTime < now) {
      const newWindow: RateLimitWindow = {
        count: 1,
        resetTime: now + windowMs,
      };
      this.windows.set(key, newWindow);
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetTime: newWindow.resetTime,
      };
    }

    // Window exists and not expired
    if (window.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: window.resetTime,
      };
    }

    window.count++;
    return {
      allowed: true,
      remaining: maxRequests - window.count,
      resetTime: window.resetTime,
    };
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// Singleton rate limiter instance
const rateLimiter = new InMemoryRateLimiter();

/**
 * Create a rate limit middleware
 */
function createRateLimitMiddleware(config: RateLimiterConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Use IP + endpoint as key for per-endpoint limiting
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${config.endpoint}`;

    const result = rateLimiter.checkLimit(key, config.maxRequests, config.windowMs);

    // Set rate limit headers
    res.set('X-RateLimit-Limit', config.maxRequests.toString());
    res.set('X-RateLimit-Remaining', result.remaining.toString());
    res.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString());

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      res.set('Retry-After', retryAfter.toString());

      logger.warn({
        ip,
        endpoint: config.endpoint,
        retryAfter,
      }, 'Rate limit exceeded');

      res.status(429).json({
        ok: false,
        error: 'RATE_LIMITED',
        message: `Too many requests. Please try again in ${retryAfter} seconds.`,
        retry_after_sec: retryAfter,
      });
      return;
    }

    next();
  };
}

// Pre-configured rate limiters for specific endpoints
// reset: 5/min
export const resetRateLimiter = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 5,
  endpoint: 'reset',
});

// qr: 60/min
export const qrRateLimiter = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60,
  endpoint: 'qr',
});

// send: 120/min
export const sendRateLimiter = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 120,
  endpoint: 'send',
});

// status: generous limit (mostly for polling)
export const statusRateLimiter = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 300, // 5 per second
  endpoint: 'status',
});

// General rate limiter for catch-all
export const generalRateLimiter = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  endpoint: 'general',
});

// Export for shutdown
export const shutdownRateLimiter = () => rateLimiter.shutdown();
