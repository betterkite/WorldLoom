/**
 * Optional DB-backed worker entry point. Keep it disabled for local web-only
 * development; enable on exactly one controlled production worker instance.
 */
export async function register() {
  // Keep this positive runtime branch so the Edge compiler can remove the
  // Node-only dependency tree before resolving worker imports.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.WORLDLOOM_WORKER !== 'true') return;
    const { startBackgroundWorker } = await import('@/lib/worker/background');
    startBackgroundWorker();
  }
}
