/**
 * HTTP Keep-Alive Agent for Ollama connections.
 *
 * Reuses TCP connections to the Ollama proxy, reducing latency on
 * subsequent requests (avoids TLS handshake + TCP connect per call).
 *
 * Uses Node.js built-in http.Agent / https.Agent.
 */

let _agent: any = null

/**
 * Returns a keep-alive HTTP(S) agent singleton, or null if unavailable.
 * Works in Node.js runtime; no-op in edge runtime.
 */
export function keepAliveAgent(): any {
  if (_agent) return _agent

  try {
    // Dynamic import to avoid breaking edge runtime
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http = require('node:http')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('node:https')

    // Determine protocol from OLLAMA_BASE_URL
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
    const isHttps = baseUrl.startsWith('https')

    const AgentClass = isHttps ? https.Agent : http.Agent

    _agent = new AgentClass({
      keepAlive: true,
      keepAliveMsecs: 30_000,
      maxSockets: 4,            // max concurrent connections to Ollama
      maxFreeSockets: 2,
      timeout: 120_000,
    })

    console.log(`[Ollama Agent] Created keep-alive ${isHttps ? 'HTTPS' : 'HTTP'} agent`)
    return _agent
  } catch {
    // Edge runtime or missing node: builtins — silently skip
    return null
  }
}
