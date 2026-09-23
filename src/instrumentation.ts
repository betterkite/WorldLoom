/**
 * Optional DB-backed worker entry point. Keep it disabled for local web-only
 * development; enable on exactly one controlled production worker instance.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.WORLDLOOM_WORKER !== 'true') return;
  const { startBackgroundWorker } = await import('@/lib/worker/background');
  startBackgroundWorker();
}
