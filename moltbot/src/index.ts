// src/index.ts
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { logger } from './utils/logger';
import { webhookHandler } from './services/webhook.handler';
import { memoryStore } from './services/memory';
import { listTools } from './tools/registry';

const app = express();

app.use(cors());
app.use(express.json());

// ========== Health & Status Endpoints ==========

// Basic health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'moltbot', 
    time: new Date().toISOString(),
    features: config.features,
  });
});

// Debug health with more info (requires secret)
app.get('/debug/health', (req, res) => {
  const secret = req.headers['x-debug-secret'] || req.query.secret;
  
  if (secret !== config.debugSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const memStats = memoryStore.getStats();
  
  res.json({
    status: 'ok',
    service: 'moltbot',
    time: new Date().toISOString(),
    uptime: process.uptime(),
    config: {
      port: config.port,
      llmProvider: config.llm.provider,
      llmModel: config.llm.provider === 'openai' ? config.llm.openai.model : config.llm.gemini.model,
      serapodBaseUrl: config.serapod.baseUrl,
      memoryMaxTurns: config.memory.maxTurns,
      memoryTtlHours: Math.round(config.memory.ttlMs / (1000 * 60 * 60)),
    },
    features: config.features,
    memory: {
      totalConversations: memStats.totalConversations,
      oldestConversation: memStats.oldestMs ? new Date(memStats.oldestMs).toISOString() : null,
      newestActivity: memStats.newestMs ? new Date(memStats.newestMs).toISOString() : null,
    },
    tools: listTools(),
  });
});

// Debug last conversation for a phone (requires secret)
app.get('/debug/last/:phone', (req, res) => {
  const secret = req.headers['x-debug-secret'] || req.query.secret;
  
  if (secret !== config.debugSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const phone = req.params.phone;
  const tenantId = (req.query.tenantId as string) || 'default';
  
  const debugInfo = memoryStore.getDebugInfo(tenantId, phone);
  
  if (!debugInfo) {
    return res.json({
      found: false,
      phone,
      tenantId,
      message: 'No conversation found for this phone',
    });
  }
  
  res.json({
    found: true,
    ...debugInfo,
  });
});

// Clear memory for a phone (requires secret)
app.delete('/debug/memory/:phone', (req, res) => {
  const secret = req.headers['x-debug-secret'] || req.query.secret;
  
  if (secret !== config.debugSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const phone = req.params.phone;
  const tenantId = (req.query.tenantId as string) || 'default';
  
  const deleted = memoryStore.clear(tenantId, phone);
  
  res.json({
    ok: true,
    deleted,
    phone,
    tenantId,
  });
});

// ========== Webhook Endpoints ==========

// Main webhook for WhatsApp inbound messages
app.post('/webhook/whatsapp', (req, res) => webhookHandler.handleInbound(req, res));

// Test AI processing (for debugging, requires secret in body)
app.post('/debug/test-ai', (req, res) => {
  const secret = req.headers['x-debug-secret'] || req.body.secret;
  
  if (secret !== config.debugSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  webhookHandler.testAI(req, res);
});

// ========== Manual Send Endpoint ==========

// Debug send endpoint
app.get('/debug/send', (req, res) => webhookHandler.manualSend(req, res));

// ========== Startup ==========

const server = app.listen(config.port, () => {
  logger.info({
    port: config.port,
    llmProvider: config.llm.provider,
    features: config.features,
  }, '🤖 Moltbot AI service started');
  
  logger.info(`Webhook endpoint: POST http://localhost:${config.port}/webhook/whatsapp`);
  logger.info(`Health check: GET http://localhost:${config.port}/health`);
  logger.info(`Debug health: GET http://localhost:${config.port}/debug/health?secret=...`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  memoryStore.stopCleanup();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  memoryStore.stopCleanup();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
