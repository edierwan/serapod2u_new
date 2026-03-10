/**
 * Next.js Instrumentation Hook
 * Runs once when the server starts up.
 *
 * Used to bootstrap the internal cron scheduler on persistent
 * servers (Coolify / Docker / VPS). Skipped on serverless platforms.
 */
export async function register() {
  // Only run on the Node.js server runtime, not in the browser or edge
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Skip on serverless platforms where background intervals are unreliable
    const isServerless =
      process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.SERVERLESS === 'true'

    if (!isServerless) {
      const { startCronScheduler } = await import('@/lib/cron-scheduler')
      startCronScheduler()
    } else {
      console.log('[Instrumentation] Serverless detected — cron scheduler disabled')
    }
  }
}
